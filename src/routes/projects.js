const express = require('express');
const router = express.Router();
const Project = require('../models/Project');
const BatchTestRun = require('../models/BatchTestRun');
const BatchTestExecutor = require('../services/BatchTestExecutor');
const Goal = require('../models/Goal');
const TestSession = require('../models/TestSession');
const SalesforceClient = require('../services/SalesforceClient');

// Store active batch executors
const activeBatchExecutors = new Map();

// Get all projects
router.get('/', async (req, res) => {
  try {
    const projects = await Project.findAll();
    res.json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// Get project by ID with goals
router.get('/:id', async (req, res) => {
  try {
    const project = await Project.findWithGoals(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Get recent batch runs
    const recentBatchRuns = await Project.getRecentBatchRuns(req.params.id);
    project.recentBatchRuns = recentBatchRuns;
    
    res.json(project);
  } catch (error) {
    console.error('Error fetching project:', error);
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

// Create new project
router.post('/', async (req, res) => {
  try {
    const { name, description, createdBy, tags, miawOrgId, miawDeploymentName, miawBaseUrl, miawRoutingAttributes } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    const project = await Project.create({
      name,
      description,
      createdBy,
      tags: tags || [],
      miawOrgId,
      miawDeploymentName,
      miawBaseUrl,
      miawRoutingAttributes
    });

    res.status(201).json(project);
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Update project
router.put('/:id', async (req, res) => {
  try {
    const { name, description, tags, status, miawOrgId, miawDeploymentName, miawBaseUrl, miawRoutingAttributes } = req.body;
    
    const updated = await Project.update(req.params.id, {
      name,
      description,
      tags,
      status,
      miawOrgId,
      miawDeploymentName,
      miawBaseUrl,
      miawRoutingAttributes
    });

    if (!updated) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const project = await Project.findById(req.params.id);
    res.json(project);
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// Delete project
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Project.delete(req.params.id);
    
    if (!deleted) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json({ message: 'Project deleted successfully' });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// Get goals for a project
router.get('/:id/goals', async (req, res) => {
  try {
    const goals = await Goal.findByProjectId(req.params.id);
    res.json(goals);
  } catch (error) {
    console.error('Error fetching goals:', error);
    res.status(500).json({ error: 'Failed to fetch goals' });
  }
});

// Get test sessions for a project
router.get('/:id/test-sessions', async (req, res) => {
  try {
    const testSessions = await TestSession.findByProjectId(req.params.id);
    res.json(testSessions);
  } catch (error) {
    console.error('Error fetching test sessions:', error);
    res.status(500).json({ error: 'Failed to fetch test sessions' });
  }
});

// Create new goal directly in project
router.post('/:id/goals', async (req, res) => {
  try {
    const { name, description, validationCriteria, steps } = req.body;
    const projectId = req.params.id;
    
    if (!name) {
      return res.status(400).json({ error: 'Goal name is required' });
    }

    // Verify project exists
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const goal = await Goal.create({
      name,
      description,
      validationCriteria: validationCriteria || [],
      steps: steps || [],
      projectId,
      enabled: true
    });

    res.status(201).json(goal);
  } catch (error) {
    console.error('Error creating goal:', error);
    res.status(500).json({ error: 'Failed to create goal' });
  }
});

// Add existing goal to project
router.post('/:id/goals/:goalId', async (req, res) => {
  try {
    const projectId = req.params.id;
    const goalId = req.params.goalId;
    
    // Verify goal exists
    const goal = await Goal.findById(goalId);
    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    // Check if goal is already assigned to a project
    if (goal.projectId && goal.projectId !== projectId) {
      return res.status(400).json({ error: 'Goal is already assigned to another project' });
    }

    // Update goal to assign it to this project
    const updated = await Goal.update(goalId, {
      projectId,
      enabled: true
    });

    if (!updated) {
      return res.status(404).json({ error: 'Failed to assign goal to project' });
    }

    const updatedGoal = await Goal.findById(goalId);
    res.json(updatedGoal);
  } catch (error) {
    console.error('Error assigning goal to project:', error);
    res.status(500).json({ error: 'Failed to assign goal to project' });
  }
});

// Update goal in project
router.put('/:projectId/goals/:goalId', async (req, res) => {
  try {
    const { name, description, enabled, validationCriteria, steps } = req.body;
    
    const updated = await Goal.update(req.params.goalId, {
      name,
      description,
      enabled,
      validationCriteria,
      steps
    });

    if (!updated) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    const goal = await Goal.findById(req.params.goalId);
    res.json(goal);
  } catch (error) {
    console.error('Error updating goal:', error);
    res.status(500).json({ error: 'Failed to update goal' });
  }
});

// Remove goal from project
router.delete('/:projectId/goals/:goalId', async (req, res) => {
  try {
    // Remove goal from project by setting project_id to null
    const updated = await Goal.update(req.params.goalId, {
      projectId: null
    });
    
    if (!updated) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    res.json({ message: 'Goal removed from project successfully' });
  } catch (error) {
    console.error('Error removing goal from project:', error);
    res.status(500).json({ error: 'Failed to remove goal from project' });
  }
});

// Start batch test run
router.post('/:id/batch-run', async (req, res) => {
  try {
    const { name, maxConcurrency } = req.body;
    const projectId = req.params.id;

    // Get enabled goals
    const goals = await Goal.findEnabledByProjectId(projectId);
    
    if (goals.length === 0) {
      return res.status(400).json({ error: 'No enabled goals found for this project' });
    }

    // Create batch executor
    const executor = new BatchTestExecutor({
      maxConcurrency: maxConcurrency || 3
    });

    // Start batch run
    const batchRunName = name || `Batch Run ${new Date().toLocaleString()}`;
    const result = await executor.startBatchRun(projectId, goals, batchRunName);

    // Store executor for progress tracking
    activeBatchExecutors.set(result.batchRunId, executor);

    // Clean up executor when done
    executor.on('batchCompleted', () => {
      activeBatchExecutors.delete(result.batchRunId);
    });

    executor.on('batchError', () => {
      activeBatchExecutors.delete(result.batchRunId);
    });

    res.json({
      batchRunId: result.batchRunId,
      message: 'Batch test run started',
      goalCount: goals.length
    });

  } catch (error) {
    console.error('Error starting batch run:', error);
    res.status(500).json({ error: 'Failed to start batch run' });
  }
});

// Get batch run status
router.get('/batch-runs/:batchRunId/status', async (req, res) => {
  try {
    const batchRunId = req.params.batchRunId;
    
    // Get batch run from database
    const batchRun = await BatchTestRun.findById(batchRunId);
    if (!batchRun) {
      return res.status(404).json({ error: 'Batch run not found' });
    }

    // Get real-time progress if executor is active
    const executor = activeBatchExecutors.get(batchRunId);
    let progress = null;
    
    if (executor) {
      progress = executor.getProgress();
    }

    res.json({
      batchRun,
      progress
    });
  } catch (error) {
    console.error('Error fetching batch run status:', error);
    res.status(500).json({ error: 'Failed to fetch batch run status' });
  }
});

// Server-Sent Events endpoint for real-time batch progress
router.get('/batch-runs/:batchRunId/events', async (req, res) => {
  const batchRunId = req.params.batchRunId;
  console.log(`SSE request for batch run: ${batchRunId}`);
  
  // Set headers for SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  // Send initial connection confirmation
  res.write('data: {"type":"connected"}\n\n');
  console.log(`SSE connection established for batch run: ${batchRunId}`);

  const executor = activeBatchExecutors.get(batchRunId);
  console.log(`Active executors: ${Array.from(activeBatchExecutors.keys())}`);
  console.log(`Executor found for ${batchRunId}: ${!!executor}`);
  
  if (!executor) {
    console.log(`No active executor found for batch run: ${batchRunId}`);
    res.write('data: {"type":"error","message":"Batch run not found or completed"}\n\n');
    res.end();
    return;
  }

  // Function to send progress updates
  const sendProgress = async () => {
    try {
      const batchRun = await BatchTestRun.findById(batchRunId);
      const progress = executor.getProgress();
      
      const data = {
        type: 'progress',
        batchRun,
        progress
      };
      
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      console.error('Error sending progress:', error);
    }
  };

  // Send initial progress
  sendProgress();

  // Set up periodic progress updates
  const progressInterval = setInterval(sendProgress, 1000);

  // Listen for batch events
  const onBatchStarted = (data) => {
    if (data.batchRunId === batchRunId) {
      res.write(`data: ${JSON.stringify({type: 'batchStarted', ...data})}\n\n`);
      sendProgress(); // Send updated progress immediately
    }
  };

  const onTestStarted = (data) => {
    if (data.batchRunId === batchRunId) {
      res.write(`data: ${JSON.stringify({type: 'testStarted', ...data})}\n\n`);
      sendProgress(); // Send updated progress immediately
    }
  };

  const onTestCompleted = (data) => {
    if (data.batchRunId === batchRunId) {
      res.write(`data: ${JSON.stringify({type: 'testCompleted', ...data})}\n\n`);
      sendProgress(); // Send updated progress immediately
    }
  };

  const onBatchCompleted = (data) => {
    if (data.batchRunId === batchRunId) {
      res.write(`data: ${JSON.stringify({type: 'batchCompleted', ...data})}\n\n`);
      cleanup();
    }
  };

  const onBatchError = (data) => {
    if (data.batchRunId === batchRunId) {
      res.write(`data: ${JSON.stringify({type: 'batchError', ...data})}\n\n`);
      cleanup();
    }
  };

  // Register event listeners
  executor.on('batchStarted', onBatchStarted);
  executor.on('testStarted', onTestStarted);
  executor.on('testCompleted', onTestCompleted);
  executor.on('batchCompleted', onBatchCompleted);
  executor.on('batchError', onBatchError);

  // Cleanup function
  const cleanup = () => {
    clearInterval(progressInterval);
    if (executor) {
      executor.removeListener('batchStarted', onBatchStarted);
      executor.removeListener('testStarted', onTestStarted);
      executor.removeListener('testCompleted', onTestCompleted);
      executor.removeListener('batchCompleted', onBatchCompleted);
      executor.removeListener('batchError', onBatchError);
    }
    res.end();
  };

  // Handle client disconnect
  req.on('close', cleanup);
  req.on('aborted', cleanup);
});

// Stop batch run
router.post('/batch-runs/:batchRunId/stop', async (req, res) => {
  try {
    const batchRunId = req.params.batchRunId;
    const executor = activeBatchExecutors.get(batchRunId);
    
    if (!executor) {
      return res.status(404).json({ error: 'Active batch run not found' });
    }

    await executor.stop();
    activeBatchExecutors.delete(batchRunId);
    
    res.json({ message: 'Batch run stopped successfully' });
  } catch (error) {
    console.error('Error stopping batch run:', error);
    res.status(500).json({ error: 'Failed to stop batch run' });
  }
});

// Get batch run results
router.get('/batch-runs/:batchRunId/results', async (req, res) => {
  try {
    const batchRunId = req.params.batchRunId;
    
    const batchRun = await BatchTestRun.findById(batchRunId);
    if (!batchRun) {
      return res.status(404).json({ error: 'Batch run not found' });
    }

    // Get detailed test session results for this batch run
    const testSessions = await TestSession.findByBatchRunId(batchRunId);
    
    // Calculate additional metrics
    const successfulTests = testSessions.filter(session => 
      session.validationResults?.goalAchieved || session.score >= 70
    ).length;
    
    const avgScore = testSessions.length > 0 
      ? testSessions.reduce((sum, session) => sum + (session.score || 0), 0) / testSessions.length 
      : 0;
    
    // Group test results by status
    const testsByStatus = {
      completed: testSessions.filter(s => s.status === 'completed').length,
      failed: testSessions.filter(s => s.status === 'failed').length,
      running: testSessions.filter(s => s.status === 'running').length,
      pending: testSessions.filter(s => s.status === 'pending').length
    };
    
    res.json({
      batchRun,
      testSessions,
      summary: {
        totalTests: batchRun.totalTestCases,
        completedTests: batchRun.completedTestCases,
        successfulTests: successfulTests,
        successRate: batchRun.successRate,
        averageScore: Math.round(avgScore * 100) / 100,
        status: batchRun.status,
        testsByStatus,
        duration: batchRun.completedAt ? 
          new Date(batchRun.completedAt) - new Date(batchRun.startedAt) : null
      }
    });
  } catch (error) {
    console.error('Error fetching batch run results:', error);
    res.status(500).json({ error: 'Failed to fetch batch run results' });
  }
});

// Get project batch runs
router.get('/:id/batch-runs', async (req, res) => {
  try {
    const projectId = req.params.id;
    const limit = parseInt(req.query.limit) || 20;
    
    const batchRuns = await BatchTestRun.findByProjectId(projectId, limit);
    
    res.json({
      batchRuns,
      projectId
    });
  } catch (error) {
    console.error('Error fetching project batch runs:', error);
    res.status(500).json({ error: 'Failed to fetch batch runs' });
  }
});

// Get project statistics
router.get('/:id/stats', async (req, res) => {
  try {
    const goals = await Goal.findByProjectId(req.params.id);
    const recentBatchRuns = await BatchTestRun.findByProjectId(req.params.id, 5);
    
    const stats = {
      total: goals.length,
      enabled: goals.filter(g => g.enabled).length,
      disabled: goals.filter(g => !g.enabled).length,
      avgDuration: goals.reduce((sum, g) => sum + (g.expectedDuration || 0), 0) / (goals.length || 1),
      maxPriority: Math.max(...goals.map(g => g.priority), 1)
    };
    
    res.json({
      goals: stats,
      recentBatchRuns: recentBatchRuns.length,
      lastBatchRun: recentBatchRuns[0] || null
    });
  } catch (error) {
    console.error('Error fetching project stats:', error);
    res.status(500).json({ error: 'Failed to fetch project stats' });
  }
});

// Test MIAW connection for a specific project
router.post('/:id/test-miaw-connection', async (req, res) => {
  try {
    const projectId = req.params.id;
    
    // Get project configuration
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Check if project has MIAW configuration
    if (!project.miawOrgId || !project.miawDeploymentName || !project.miawBaseUrl) {
      return res.status(400).json({ 
        error: 'Project missing MIAW configuration',
        details: 'Please configure Org ID, Deployment Name, and Base URL for this project'
      });
    }
    
    // Test connection with project-specific configuration
    const salesforceClient = new SalesforceClient(project);
    
    try {
      const startTime = Date.now();
      await salesforceClient.generateUnauthenticatedToken();
      const endTime = Date.now();
      
      res.json({
        success: true,
        message: 'MIAW connection successful',
        responseTime: endTime - startTime,
        configuration: {
          orgId: project.miawOrgId,
          deploymentName: project.miawDeploymentName,
          baseUrl: project.miawBaseUrl
        }
      });
    } catch (connectionError) {
      console.error('MIAW connection test failed:', connectionError);
      res.status(400).json({
        success: false,
        error: 'MIAW connection failed',
        details: connectionError.message,
        configuration: {
          orgId: project.miawOrgId,
          deploymentName: project.miawDeploymentName,
          baseUrl: project.miawBaseUrl
        }
      });
    }
    
  } catch (error) {
    console.error('Error testing MIAW connection:', error);
    res.status(500).json({ error: 'Failed to test MIAW connection' });
  }
});

// Delete batch run
router.delete('/batch-runs/:batchRunId', async (req, res) => {
  try {
    const batchRunId = req.params.batchRunId;
    
    const deleted = await BatchTestRun.delete(batchRunId);
    if (!deleted) {
      return res.status(404).json({ error: 'Batch run not found' });
    }
    
    res.json({ message: 'Batch run deleted successfully' });
  } catch (error) {
    console.error('Error deleting batch run:', error);
    res.status(500).json({ error: 'Failed to delete batch run' });
  }
});

// Export batch run results as CSV
router.get('/batch-runs/:batchRunId/export', async (req, res) => {
  try {
    const batchRunId = req.params.batchRunId;
    
    const batchRun = await BatchTestRun.findById(batchRunId);
    if (!batchRun) {
      return res.status(404).json({ error: 'Batch run not found' });
    }

    // Get detailed test session results with goal information
    const testSessions = await TestSession.findByBatchRunId(batchRunId);
    
    // Create CSV content
    const csvHeaders = [
      'Batch Run Name', 'Project Name', 'Goal Name', 'Goal Description', 'Goal Steps', 
      'Validation Criteria', 'Source Conversation ID', 'Original Conversation Data', 'MIAW Session ID', 
      'Test Status', 'Score (%)', 'Goal Achieved', 'Start Time', 'End Time', 'Duration (min)', 
      'End Reason', 'Full Conversation Log', 'Validation Summary', 'Issues Found', 'Completed Actions'
    ];

    const csvRows = [];
    
    // Add header row
    csvRows.push(csvHeaders.join(','));
    
    // Add batch summary row
    const batchSummary = [
      `"${(batchRun.name || 'Unnamed Batch Run').replace(/"/g, '""')}"`,
      `"${(batchRun.projectName || 'Unknown Project').replace(/"/g, '""')}"`,
      `"BATCH SUMMARY"`,
      `"Total Tests: ${batchRun.totalTestCases}, Completed: ${batchRun.completedTestCases}, Success Rate: ${Math.round(batchRun.successRate)}%"`,
      `""`, `""`, `""`, `""`, `""`, `"${batchRun.status}"`, `"${Math.round(batchRun.successRate)}"`, `""`,
      `"${batchRun.startedAt ? new Date(batchRun.startedAt).toLocaleString() : ''}"`,
      `"${batchRun.completedAt ? new Date(batchRun.completedAt).toLocaleString() : ''}"`,
      `"${batchRun.completedAt && batchRun.startedAt ? 
        Math.round((new Date(batchRun.completedAt) - new Date(batchRun.startedAt)) / 60000) : ''}"`,
      `""`, `""`, `""`, `""`, `""`
    ];
    csvRows.push(batchSummary.join(','));
    
    // Add individual test session rows
    testSessions.forEach(session => {
      // Format conversation log
      const conversationLog = session.conversationLog && session.conversationLog.length > 0
        ? session.conversationLog.map(msg => 
            `${msg.sender}: ${(msg.message || '').replace(/"/g, '""')}`
          ).join('\n')
        : 'No conversation log';
      
      // Format validation results
      const validationSummary = session.validationResults
        ? `Goal Achieved: ${session.validationResults.goalAchieved ? 'Yes' : 'No'}${
            session.validationResults.summary ? ` | Summary: ${session.validationResults.summary.replace(/"/g, '""')}` : ''
          }`
        : 'No validation results';
      
      const issues = session.validationResults?.issues && session.validationResults.issues.length > 0
        ? session.validationResults.issues.join('; ')
        : 'None';
      
      const completedActions = session.validationResults?.completedActions && session.validationResults.completedActions.length > 0
        ? session.validationResults.completedActions.join('; ')
        : 'None';
      
      // Get goal steps as a string (assuming it's stored as JSON array)
      let goalSteps = '';
      try {
        if (session.goalSteps) {
          const steps = typeof session.goalSteps === 'string' ? JSON.parse(session.goalSteps) : session.goalSteps;
          goalSteps = Array.isArray(steps) ? steps.join('; ') : session.goalSteps;
        }
      } catch (e) {
        goalSteps = session.goalSteps || '';
      }
      
      // Get validation criteria as a string
      let validationCriteria = '';
      try {
        if (session.goalValidationCriteria) {
          const criteria = typeof session.goalValidationCriteria === 'string' 
            ? JSON.parse(session.goalValidationCriteria) 
            : session.goalValidationCriteria;
          validationCriteria = Array.isArray(criteria) ? criteria.join('; ') : session.goalValidationCriteria;
        }
      } catch (e) {
        validationCriteria = session.goalValidationCriteria || '';
      }
      
      const row = [
        `"${(batchRun.name || 'Unnamed Batch Run').replace(/"/g, '""')}"`,
        `"${(batchRun.projectName || 'Unknown Project').replace(/"/g, '""')}"`,
        `"${(session.goalName || 'Unknown Goal').replace(/"/g, '""')}"`,
        `"${(session.goalDescription || '').replace(/"/g, '""')}"`,
        `"${goalSteps.replace(/"/g, '""')}"`,
        `"${validationCriteria.replace(/"/g, '""')}"`,
        `"${(session.goalSourceConversationId || '').replace(/"/g, '""')}"`,
        `"${(session.goalSourceConversationData || '').replace(/"/g, '""')}"`,
        `"${(session.miawSessionId || session.miaw_session_id || '').replace(/"/g, '""')}"`,
        `"${session.status}"`,
        `"${session.score !== null ? Math.round(session.score) : ''}"`,
        `"${session.validationResults?.goalAchieved ? 'Yes' : 'No'}"`,
        `"${session.startedAt ? new Date(session.startedAt).toLocaleString() : ''}"`,
        `"${session.completedAt ? new Date(session.completedAt).toLocaleString() : ''}"`,
        `"${session.completedAt && session.startedAt ? 
          Math.round((new Date(session.completedAt) - new Date(session.startedAt)) / 60000) : ''}"`,
        `"${(session.endReason || session.end_reason || '').replace(/"/g, '""')}"`,
        `"${conversationLog.replace(/"/g, '""')}"`,
        `"${validationSummary.replace(/"/g, '""')}"`,
        `"${issues.replace(/"/g, '""')}"`,
        `"${completedActions.replace(/"/g, '""')}"`
      ];
      csvRows.push(row.join(','));
    });

    const csvContent = csvRows.join('\n');
    const filename = `batch-run-export-${batchRun.name?.replace(/[^a-z0-9]/gi, '_') || 'unnamed'}-${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\ufeff' + csvContent); // Add BOM for Excel UTF-8 support
    
  } catch (error) {
    console.error('Error exporting batch run CSV:', error);
    res.status(500).json({ error: 'Failed to export batch run results' });
  }
});

module.exports = router;