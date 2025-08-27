const express = require('express');
const router = express.Router();
const TestingAgent = require('../services/TestingAgent');
const SalesforceClient = require('../services/SalesforceClient');

router.post('/test-connection', async (req, res) => {
  try {
    const salesforceClient = new SalesforceClient();
    const result = await salesforceClient.testConnection();
    
    res.json({ 
      status: 'success', 
      message: result.message,
      endpointUrl: result.endpointUrl,
      hasConfiguration: result.hasConfiguration
    });
  } catch (error) {
    console.error('MIAW connection test failed:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to connect to MIAW: ' + error.message 
    });
  }
});

router.post('/test-openai', async (req, res) => {
  try {
    const testingAgent = new TestingAgent();
    const testGoal = {
      name: 'Test Goal',
      description: 'This is a test goal to verify OpenAI connectivity',
      steps: ['Test step 1', 'Test step 2'],
      validationCriteria: ['Verify connection works']
    };
    
    const plan = await testingAgent.generateConversationPlan(testGoal);
    
    res.json({ 
      status: 'success', 
      message: 'Successfully connected to OpenAI',
      testPlan: plan 
    });
  } catch (error) {
    console.error('OpenAI connection test failed:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to connect to OpenAI: ' + error.message 
    });
  }
});

router.post('/start-conversation', async (req, res) => {
  try {
    const salesforceClient = new SalesforceClient();
    const conversation = await salesforceClient.startConversation();
    
    res.json({ 
      status: 'success',
      conversation 
    });
  } catch (error) {
    console.error('Error starting conversation:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to start conversation: ' + error.message 
    });
  }
});

router.post('/send-message', async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const salesforceClient = new SalesforceClient();
    const result = await salesforceClient.sendMessage(message);
    
    setTimeout(async () => {
      try {
        const messages = await salesforceClient.getMessages();
        res.json({ 
          status: 'success',
          sent: result,
          messages 
        });
      } catch (error) {
        res.json({ 
          status: 'partial_success',
          sent: result,
          error: 'Could not retrieve response: ' + error.message
        });
      }
    }, 2000);
    
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to send message: ' + error.message 
    });
  }
});

router.get('/data-snapshot', async (req, res) => {
  try {
    const salesforceClient = new SalesforceClient();
    const snapshot = await salesforceClient.captureDataSnapshot();
    
    res.json({ 
      status: 'success',
      snapshot 
    });
  } catch (error) {
    console.error('Error capturing data snapshot:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to capture data snapshot: ' + error.message 
    });
  }
});

// Debug endpoint to inspect environment and configuration
router.get('/debug', async (req, res) => {
  try {
    res.json({
      environment: {
        SALESFORCE_MESSAGING_DEPLOYMENT_NAME: process.env.SALESFORCE_MESSAGING_DEPLOYMENT_NAME,
        SALESFORCE_MESSAGING_ORG_ID: process.env.SALESFORCE_MESSAGING_ORG_ID,
        SALESFORCE_MIAW_BASE_URL: process.env.SALESFORCE_MIAW_BASE_URL,
        NODE_ENV: process.env.NODE_ENV
      },
      timestamp: new Date().toISOString(),
      nodeVersion: process.version
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;