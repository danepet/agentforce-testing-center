const express = require('express');
const router = express.Router();
const TestSession = require('../models/TestSession');
const Goal = require('../models/Goal');
const Project = require('../models/Project');
const TestingAgent = require('../services/TestingAgent');
const SalesforceClient = require('../services/SalesforceClient');

// No more simulated responses - we test the real AI Agent or fail

router.post('/start', async (req, res) => {
  try {
    const { goalId } = req.body;
    
    if (!goalId) {
      return res.status(400).json({ error: 'Goal ID is required' });
    }

    const goal = await Goal.findById(goalId);
    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    const testSession = await TestSession.create({
      goalId,
      status: 'pending'
    });

    res.status(201).json(testSession);
  } catch (error) {
    console.error('Error starting test:', error);
    res.status(500).json({ error: 'Failed to start test session' });
  }
});

router.post('/:id/run', async (req, res) => {
  try {
    const session = await TestSession.findById(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Test session not found' });
    }

    const goal = await Goal.findById(session.goalId);
    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    // Fetch project configuration for MIAW settings
    const project = await Project.findById(goal.projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    await TestSession.update(session.id, { status: 'running' });

    const testingAgent = new TestingAgent();
    const salesforceClient = new SalesforceClient(project);

    try {
      const beforeSnapshot = await salesforceClient.captureDataSnapshot();
      await TestSession.update(session.id, { 
        salesforceDataBefore: beforeSnapshot 
      });

      const conversationInfo = await salesforceClient.startConversation();
      const miawSessionId = conversationInfo?.conversationId || salesforceClient.conversationId;
      
      // Store the MIAW session ID in the test session
      if (miawSessionId) {
        await TestSession.update(session.id, { miawSessionId: miawSessionId });
        console.log('MIAW Session ID stored:', miawSessionId);
      }
      
      // Start persistent SSE connection for the entire conversation
      console.log('Starting persistent SSE connection for full conversation...');
      const conversationSession = await salesforceClient.startConversationSession();
      
      const conversationLog = [];
      const maxMessages = 20; // Increased since we're now adaptive
      let conversationComplete = false;
      let endReason = null;

      // Wait for initial Agentforce greeting before starting our test conversation
      console.log('Waiting for initial Agentforce greeting...');
      const initialGreeting = await conversationSession.waitForResponse();
      
      if (initialGreeting) {
        conversationLog.push({
          sender: 'Agentforce',
          message: initialGreeting,
          timestamp: new Date().toISOString()
        });
        
        console.log(`AI Agent greeted us: "${initialGreeting}"`);
      } else {
        console.log('No initial greeting received from Agentforce');
      }

      // Generate and send initial message
      console.log('Generating initial user message...');
      // For now, pass null for sourceConversationData - could be enhanced later to fetch actual conversation
      const initialMessage = await testingAgent.generateInitialMessage(goal, null);
      
      // Store customer data for consistency throughout the conversation
      const customerData = testingAgent.generateRealisticData(null);
      
      conversationLog.push({
        sender: 'TestingAgent',
        message: initialMessage,
        timestamp: new Date().toISOString()
      });

      console.log(`Sending initial message: "${initialMessage}"`);
      await salesforceClient.sendMessage(initialMessage);

      // Dynamic conversation loop
      while (!conversationComplete && conversationLog.length < maxMessages) {
        // Wait for AI Agent response via persistent SSE connection
        console.log('Waiting for AI Agent response...');
        const agentforceResponse = await conversationSession.waitForResponse();

        if (agentforceResponse) {
          conversationLog.push({
            sender: 'Agentforce',
            message: agentforceResponse,
            timestamp: new Date().toISOString()
          });
          
          console.log(`AI Agent responded: "${agentforceResponse}"`);
          
          // Generate next message based on the conversation so far
          console.log('Generating adaptive response...');
          const nextMessage = await testingAgent.generateResponse(conversationLog, goal, agentforceResponse, customerData, null);
          
          // Check if goal is achieved or failed
          if (nextMessage.startsWith('GOAL_ACHIEVED:') || nextMessage.startsWith('GOAL_FAILED:')) {
            console.log(`Test completed: ${nextMessage}`);
            conversationComplete = true;
            break;
          }
          
          // Add next message to log and send it
          conversationLog.push({
            sender: 'TestingAgent',
            message: nextMessage,
            timestamp: new Date().toISOString()
          });

          console.log(`Sending adaptive response: "${nextMessage}"`);
          await salesforceClient.sendMessage(nextMessage);
          
          // Let Testing Agent evaluate if conversation should continue
          const shouldContinue = await testingAgent.evaluateConversationContinue(
            goal,
            conversationLog,
            'adaptive_response'
          );
          
          if (!shouldContinue.continue) {
            console.log(`Conversation ending: ${shouldContinue.reason}`);
            endReason = shouldContinue.reason;
            conversationComplete = true;
            break;
          }
        } else {
          throw new Error('No response received from Agentforce AI Agent');
        }
      }

      // Close the persistent SSE connection
      await conversationSession.close();
      await salesforceClient.endConversation();

      // Set end reason if not already set (e.g., max messages reached)
      if (!endReason) {
        if (conversationLog.length >= maxMessages) {
          endReason = `Maximum message limit reached (${maxMessages} messages)`;
        } else {
          endReason = 'Conversation ended unexpectedly';
        }
      }

      const afterSnapshot = await salesforceClient.captureDataSnapshot();
      
      const analysis = await testingAgent.analyzeConversationSuccess(
        goal, 
        conversationLog, 
        beforeSnapshot, 
        afterSnapshot
      );

      await TestSession.update(session.id, {
        status: 'completed',
        conversationLog,
        salesforceDataAfter: afterSnapshot,
        validationResults: analysis,
        score: analysis.score,
        endReason: endReason
      });

      const updatedSession = await TestSession.findById(session.id);
      res.json(updatedSession);

    } catch (executionError) {
      console.error('Test execution error:', executionError);
      await TestSession.update(session.id, { 
        status: 'failed',
        validationResults: { error: executionError.message }
      });
      throw executionError;
    }

  } catch (error) {
    console.error('Error running test:', error);
    res.status(500).json({ error: 'Failed to run test session' });
  }
});

router.get('/', async (req, res) => {
  try {
    const sessions = await TestSession.findAll();
    res.json(sessions);
  } catch (error) {
    console.error('Error fetching test sessions:', error);
    res.status(500).json({ error: 'Failed to fetch test sessions' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const session = await TestSession.findById(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Test session not found' });
    }
    res.json(session);
  } catch (error) {
    console.error('Error fetching test session:', error);
    res.status(500).json({ error: 'Failed to fetch test session' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const deleted = await TestSession.delete(req.params.id);
    
    if (!deleted) {
      return res.status(404).json({ error: 'Test session not found' });
    }

    res.json({ message: 'Test session deleted successfully' });
  } catch (error) {
    console.error('Error deleting test session:', error);
    res.status(500).json({ error: 'Failed to delete test session' });
  }
});

module.exports = router;