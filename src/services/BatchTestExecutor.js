const EventEmitter = require('events');
const SalesforceClient = require('./SalesforceClient');
const TestingAgent = require('./TestingAgent');
const TestSession = require('../models/TestSession');
const BatchTestRun = require('../models/BatchTestRun');
const Project = require('../models/Project');

class BatchTestExecutor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxConcurrency = options.maxConcurrency || 3;
    this.activeWorkers = new Map();
    this.testQueue = [];
    this.batchRunId = null;
    this.projectConfig = null; // Store project configuration
    this.testingAgent = new TestingAgent();
    this.results = {
      total: 0,
      completed: 0,
      successful: 0,
      failed: 0,
      errors: []
    };
  }

  async startBatchRun(projectId, goals, batchRunName) {
    try {
      // Fetch project configuration for MIAW settings
      this.projectConfig = await Project.findById(projectId);
      
      this.batchRunId = await this.createBatchRun(projectId, goals, batchRunName);
      this.results.total = goals.length;
      this.testQueue = [...goals];

      console.log(`Starting batch run ${this.batchRunId} with ${goals.length} goals`);
      this.emit('batchStarted', {
        batchRunId: this.batchRunId,
        totalTests: goals.length
      });

      await BatchTestRun.update(this.batchRunId, { status: 'running' });

      // Start workers up to max concurrency
      const workerCount = Math.min(this.maxConcurrency, goals.length);
      const workerPromises = [];

      for (let i = 0; i < workerCount; i++) {
        workerPromises.push(this.startWorker(i));
      }

      // Wait for all workers to complete
      await Promise.all(workerPromises);

      // Finalize batch run
      await this.finalizeBatchRun();

      return {
        batchRunId: this.batchRunId,
        results: this.results
      };

    } catch (error) {
      console.error('Batch run failed:', error);
      if (this.batchRunId) {
        await BatchTestRun.update(this.batchRunId, {
          status: 'failed',
          errorDetails: [error.message]
        });
      }
      this.emit('batchError', { batchRunId: this.batchRunId, error: error.message });
      throw error;
    }
  }

  async createBatchRun(projectId, goals, batchRunName) {
    const batchRun = await BatchTestRun.create({
      projectId,
      name: batchRunName || `Batch Run ${new Date().toLocaleString()}`,
      totalTestCases: goals.length,
      status: 'pending'
    });
    return batchRun.id;
  }

  async startWorker(workerId) {
    console.log(`Starting worker ${workerId}`);
    
    while (this.testQueue.length > 0) {
      const goal = this.testQueue.shift();
      if (!goal) break;

      try {
        this.activeWorkers.set(workerId, goal.id);
        
        this.emit('testStarted', {
          batchRunId: this.batchRunId,
          workerId,
          goalId: goal.id,
          goalName: goal.name
        });

        const result = await this.executeGoal(goal, workerId);
        
        this.results.completed++;
        if (result.success) {
          this.results.successful++;
        } else {
          this.results.failed++;
          this.results.errors.push({
            goalId: goal.id,
            goalName: goal.name,
            error: result.error
          });
        }

        // Update batch run progress
        const successRate = this.results.completed > 0 ? 
          (this.results.successful / this.results.completed) * 100 : 0;

        await BatchTestRun.update(this.batchRunId, {
          completedTestCases: this.results.completed,
          successRate: Math.round(successRate * 100) / 100
        });

        this.emit('testCompleted', {
          batchRunId: this.batchRunId,
          workerId,
          goalId: goal.id,
          goalName: goal.name,
          success: result.success,
          sessionId: result.sessionId,
          progress: {
            completed: this.results.completed,
            total: this.results.total,
            percentage: Math.round((this.results.completed / this.results.total) * 100)
          }
        });

      } catch (error) {
        console.error(`Worker ${workerId} error processing goal ${goal.id}:`, error);
        this.results.completed++;
        this.results.failed++;
        this.results.errors.push({
          goalId: goal.id,
          goalName: goal.name,
          error: error.message
        });

        this.emit('testError', {
          batchRunId: this.batchRunId,
          workerId,
          goalId: goal.id,
          goalName: goal.name,
          error: error.message
        });
      } finally {
        this.activeWorkers.delete(workerId);
      }
    }

    console.log(`Worker ${workerId} finished`);
  }

  async executeGoal(goal, workerId) {
    const startTime = Date.now();
    let salesforceClient = null;
    let conversationSession = null;
    let testSession = null;

    try {
      console.log(`Worker ${workerId}: Executing goal ${goal.name}`);

      // Create a new Salesforce client for this worker with project-specific config
      salesforceClient = new SalesforceClient(this.projectConfig);
      await salesforceClient.generateUnauthenticatedToken();

      // Create test session
      testSession = await TestSession.create({
        goalId: goal.id,
        batchRunId: this.batchRunId,
        status: 'running'
      });

      const conversationLog = [];
      const maxMessages = 20; // Increased since we're now adaptive
      let conversationComplete = false;
      let endReason = null;

      // Start MIAW conversation
      const conversationInfo = await salesforceClient.startConversation();
      const miawSessionId = conversationInfo?.conversationId || salesforceClient.conversationId;
      
      // Store the MIAW session ID in the test session
      if (miawSessionId) {
        await TestSession.update(testSession.id, { miawSessionId: miawSessionId });
        console.log(`Worker ${workerId}: MIAW Session ID stored:`, miawSessionId);
      }
      
      conversationSession = await salesforceClient.startConversationSession();

      // Wait for initial Agentforce greeting before starting our test conversation
      console.log(`Worker ${workerId}: Waiting for initial Agentforce greeting...`);
      const initialGreeting = await conversationSession.waitForResponse();
      
      if (initialGreeting) {
        conversationLog.push({
          sender: 'Agentforce',
          message: initialGreeting,
          timestamp: new Date().toISOString()
        });
        
        console.log(`Worker ${workerId}: AI Agent greeted us: "${initialGreeting}"`);
      } else {
        console.log(`Worker ${workerId}: No initial greeting received from Agentforce`);
      }

      // Generate and send initial message
      console.log(`Worker ${workerId}: Generating initial user message...`);
      const initialMessage = await this.testingAgent.generateInitialMessage(goal, null);
      
      // Store customer data for consistency throughout the conversation
      const customerData = this.testingAgent.generateRealisticData(null);
      
      conversationLog.push({
        sender: 'TestingAgent',
        message: initialMessage,
        timestamp: new Date().toISOString()
      });

      console.log(`Worker ${workerId}: Sending initial message: "${initialMessage}"`);
      await salesforceClient.sendMessage(initialMessage);

      // Dynamic conversation loop
      while (!conversationComplete && conversationLog.length < maxMessages) {
        const agentforceResponse = await conversationSession.waitForResponse();
        
        if (agentforceResponse) {
          conversationLog.push({
            sender: 'Agentforce',
            message: agentforceResponse,
            timestamp: new Date().toISOString()
          });

          console.log(`Worker ${workerId}: AI Agent responded: "${agentforceResponse}"`);
          
          // Generate next message based on the conversation so far
          console.log(`Worker ${workerId}: Generating adaptive response...`);
          const nextMessage = await this.testingAgent.generateResponse(conversationLog, goal, agentforceResponse, customerData, null);
          
          // Check if goal is achieved or failed
          if (nextMessage.startsWith('GOAL_ACHIEVED:') || nextMessage.startsWith('GOAL_FAILED:')) {
            console.log(`Worker ${workerId}: Test completed: ${nextMessage}`);
            conversationComplete = true;
            break;
          }
          
          // Add next message to log and send it
          conversationLog.push({
            sender: 'TestingAgent',
            message: nextMessage,
            timestamp: new Date().toISOString()
          });

          console.log(`Worker ${workerId}: Sending adaptive response: "${nextMessage}"`);
          await salesforceClient.sendMessage(nextMessage);

          // Evaluate whether to continue
          const shouldContinue = await this.testingAgent.evaluateConversationContinue(
            goal, conversationLog, 'adaptive_response'
          );
          
          if (!shouldContinue.continue) {
            console.log(`Worker ${workerId}: Conversation ending: ${shouldContinue.reason}`);
            endReason = shouldContinue.reason;
            conversationComplete = true;
            break;
          }
        } else {
          throw new Error('No response received from Agentforce AI Agent');
        }
      }

      // Set end reason if not already set (e.g., max messages reached)
      if (!endReason) {
        if (conversationLog.length >= maxMessages) {
          endReason = `Maximum message limit reached (${maxMessages} messages)`;
        } else {
          endReason = 'Conversation ended unexpectedly';
        }
      }

      // Analyze conversation results
      const validationResults = await this.testingAgent.analyzeConversationSuccess(
        goal, conversationLog, {}, {}
      );

      // Update test session with results
      await TestSession.update(testSession.id, {
        status: 'completed',
        conversationLog,
        validationResults,
        score: validationResults.score || 0,
        endReason: endReason
      });

      const duration = Date.now() - startTime;
      console.log(`Worker ${workerId}: Goal ${goal.name} completed in ${duration}ms`);

      return {
        success: validationResults.goalAchieved || false,
        sessionId: testSession.id,
        score: validationResults.score || 0,
        duration
      };

    } catch (error) {
      console.error(`Worker ${workerId}: Goal ${goal.name} failed:`, error);
      
      if (testSession) {
        await TestSession.update(testSession.id, {
          status: 'failed',
          validationResults: { error: error.message }
        });
      }

      return {
        success: false,
        sessionId: testSession?.id,
        error: error.message,
        duration: Date.now() - startTime
      };
    } finally {
      // Cleanup resources
      if (conversationSession) {
        try {
          await conversationSession.cleanup();
        } catch (cleanupError) {
          console.error(`Worker ${workerId}: Cleanup error:`, cleanupError);
        }
      }
    }
  }

  async finalizeBatchRun() {
    const successRate = this.results.total > 0 ? 
      (this.results.successful / this.results.total) * 100 : 0;

    await BatchTestRun.update(this.batchRunId, {
      status: 'completed',
      completedTestCases: this.results.completed,
      successRate: Math.round(successRate * 100) / 100,
      errorDetails: this.results.errors
    });

    this.emit('batchCompleted', {
      batchRunId: this.batchRunId,
      results: this.results,
      successRate
    });
    
    // Clean up resources after completion
    setTimeout(() => {
      this.cleanup();
    }, 1000); // Short delay to allow events to be processed

    console.log(`Batch run ${this.batchRunId} completed:`, this.results);
  }

  getProgress() {
    return {
      batchRunId: this.batchRunId,
      total: this.results.total,
      completed: this.results.completed,
      successful: this.results.successful,
      failed: this.results.failed,
      percentage: this.results.total > 0 ? 
        Math.round((this.results.completed / this.results.total) * 100) : 0,
      activeWorkers: Array.from(this.activeWorkers.entries()).map(([workerId, goalId]) => ({
        workerId,
        goalId
      })),
      queueLength: this.testQueue.length
    };
  }

  async stop() {
    console.log(`Stopping batch run ${this.batchRunId}`);
    this.testQueue = [];
    
    if (this.batchRunId) {
      await BatchTestRun.update(this.batchRunId, {
        status: 'stopped',
        errorDetails: ['Batch run was manually stopped']
      });
    }

    this.emit('batchStopped', { batchRunId: this.batchRunId });
    
    // Clean up resources and event listeners
    this.cleanup();
  }

  cleanup() {
    // Clear all workers
    for (const [workerId, worker] of this.activeWorkers) {
      if (worker && typeof worker.cleanup === 'function') {
        try {
          worker.cleanup();
        } catch (error) {
          console.error(`Error cleaning up worker ${workerId}:`, error);
        }
      }
    }
    this.activeWorkers.clear();
    
    // Clear queue
    this.testQueue = [];
    
    // Remove all event listeners to prevent memory leaks
    this.removeAllListeners();
    
    // Clean up testing agent if it has cleanup method
    if (this.testingAgent && typeof this.testingAgent.cleanup === 'function') {
      try {
        this.testingAgent.cleanup();
      } catch (error) {
        console.error('Error cleaning up testing agent:', error);
      }
    }
    
    // Reset state
    this.batchRunId = null;
    this.projectConfig = null;
    this.results = {
      total: 0,
      completed: 0,
      successful: 0,
      failed: 0,
      errors: []
    };
  }
}

module.exports = BatchTestExecutor;