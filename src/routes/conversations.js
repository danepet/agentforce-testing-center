const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const CSVProcessor = require('../services/CSVProcessor');
const Goal = require('../models/Goal');

// Initialize CSV processor
const csvProcessor = new CSVProcessor();

// Configure multer for file uploads
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed'), false);
        }
    }
});

// Upload and process CSV file
router.post('/upload', upload.single('csvFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No CSV file uploaded' });
        }

        const options = {
            generateGoals: req.body.generateGoals !== 'false',
            batchSize: parseInt(req.body.batchSize) || 10,
            projectId: req.body.projectId
        };

        console.log(`Processing CSV upload: ${req.file.originalname} (${req.file.size} bytes)`);
        
        const result = await csvProcessor.processUpload(req.file.path, options);
        
        // Clean up uploaded file
        fs.unlinkSync(req.file.path);
        
        res.json({
            success: true,
            jobId: result.jobId,
            summary: result.summary,
            estimatedTime: result.estimatedTime,
            parseErrors: result.parseErrors
        });
    } catch (error) {
        console.error('CSV upload error:', error);
        
        // Clean up file if it exists
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        res.status(400).json({ 
            error: error.message,
            details: error.stack 
        });
    }
});

// Get processing job status
router.get('/jobs/:jobId/status', (req, res) => {
    try {
        const status = csvProcessor.getJobStatus(req.params.jobId);
        
        if (status.error) {
            return res.status(404).json(status);
        }
        
        res.json(status);
    } catch (error) {
        console.error('Error getting job status:', error);
        res.status(500).json({ error: 'Failed to get job status' });
    }
});

// Get processing job results
router.get('/jobs/:jobId/results', (req, res) => {
    try {
        const includeDetails = req.query.details === 'true';
        const results = csvProcessor.getJobResults(req.params.jobId, includeDetails);
        
        if (results.error) {
            return res.status(404).json(results);
        }
        
        res.json(results);
    } catch (error) {
        console.error('Error getting job results:', error);
        res.status(500).json({ error: 'Failed to get job results' });
    }
});

// Get analytics for processed conversations
router.get('/jobs/:jobId/analytics', (req, res) => {
    try {
        const results = csvProcessor.getJobResults(req.params.jobId, true);
        
        if (results.error) {
            return res.status(404).json(results);
        }
        
        if (!results.analysisResults) {
            return res.status(400).json({ error: 'No analysis results available' });
        }
        
        const analytics = csvProcessor.generateAnalytics(results.analysisResults);
        res.json(analytics);
    } catch (error) {
        console.error('Error generating analytics:', error);
        res.status(500).json({ error: 'Failed to generate analytics' });
    }
});

// Import generated goals to a project
router.post('/jobs/:jobId/import', async (req, res) => {
    try {
        const { projectId, selectedGoalIds, options = {} } = req.body;
        
        if (!projectId) {
            return res.status(400).json({ error: 'Project ID is required' });
        }
        
        const results = csvProcessor.getJobResults(req.params.jobId, true);
        
        if (results.error) {
            return res.status(404).json(results);
        }
        
        if (!results.generatedGoals || results.generatedGoals.length === 0) {
            return res.status(400).json({ error: 'No generated goals available for import' });
        }
        
        // Filter goals if specific IDs provided
        let goalsToImport = results.generatedGoals;
        if (selectedGoalIds && selectedGoalIds.length > 0) {
            goalsToImport = results.generatedGoals.filter(goal => 
                selectedGoalIds.includes(goal.sourceConversationId)
            );
        }
        
        const importResults = {
            imported: [],
            failed: [],
            duplicates: []
        };
        
        // Import goals one by one
        for (const goalData of goalsToImport) {
            try {
                // Check for duplicates if requested
                if (options.checkDuplicates) {
                    const existingGoals = await Goal.findByProjectId(projectId);
                    const duplicate = existingGoals.find(existing => 
                        existing.name.toLowerCase() === goalData.name.toLowerCase()
                    );
                    
                    if (duplicate) {
                        importResults.duplicates.push({
                            goalName: goalData.name,
                            existingId: duplicate.id,
                            reason: 'Name already exists in project'
                        });
                        continue;
                    }
                }
                
                // Create the goal
                const goal = await Goal.create({
                    name: goalData.name,
                    description: goalData.description,
                    steps: goalData.steps || [],
                    validationCriteria: goalData.validationCriteria || [],
                    projectId: projectId,
                    sourceConversationId: goalData.sourceConversationId,
                    sourceConversationData: goalData.sourceConversationData,
                    enabled: true,
                    metadata: JSON.stringify({
                        ...goalData.metadata,
                        importedFrom: 'csv_conversation',
                        jobId: req.params.jobId,
                        qualityScore: goalData.qualityScore,
                        aiConsiderations: goalData.aiConsiderations,
                        importedAt: new Date().toISOString()
                    })
                });
                
                importResults.imported.push({
                    goalId: goal.id,
                    goalName: goal.name,
                    sourceConversationId: goalData.sourceConversationId
                });
                
            } catch (error) {
                console.error(`Error importing goal ${goalData.name}:`, error);
                importResults.failed.push({
                    goalName: goalData.name,
                    error: error.message,
                    sourceConversationId: goalData.sourceConversationId
                });
            }
        }
        
        res.json({
            success: true,
            summary: {
                totalGoals: goalsToImport.length,
                imported: importResults.imported.length,
                failed: importResults.failed.length,
                duplicates: importResults.duplicates.length
            },
            results: importResults
        });
        
    } catch (error) {
        console.error('Error importing goals:', error);
        res.status(500).json({ error: 'Failed to import goals' });
    }
});

// Get sample conversation data for preview
router.get('/jobs/:jobId/sample', (req, res) => {
    try {
        const results = csvProcessor.getJobResults(req.params.jobId, true);
        
        if (results.error) {
            return res.status(404).json(results);
        }
        
        // Return a sample of analysis results for preview
        const sampleSize = parseInt(req.query.limit) || 5;
        const sample = results.analysisResults.slice(0, sampleSize).map(analysis => ({
            id: analysis.id,
            category: analysis.category,
            complexity: analysis.complexity,
            intentAnalysis: analysis.intentAnalysis,
            emotionalTone: analysis.emotionalTone,
            conversationPattern: analysis.conversationPattern
        }));
        
        res.json(sample);
    } catch (error) {
        console.error('Error getting sample data:', error);
        res.status(500).json({ error: 'Failed to get sample data' });
    }
});

// Test endpoint for analyzing a single conversation
router.post('/analyze-single', async (req, res) => {
    try {
        const { conversationId, conversationData } = req.body;
        
        if (!conversationId || !conversationData) {
            return res.status(400).json({ 
                error: 'Both conversationId and conversationData are required' 
            });
        }
        
        const analyzer = csvProcessor.analyzer;
        const analysis = await analyzer.analyzeConversation(conversationId, conversationData);
        
        res.json(analysis);
    } catch (error) {
        console.error('Error analyzing single conversation:', error);
        res.status(400).json({ error: error.message });
    }
});

// Generate goal from single conversation
router.post('/generate-goal', async (req, res) => {
    try {
        const { conversationId, conversationData } = req.body;
        
        if (!conversationId || !conversationData) {
            return res.status(400).json({ 
                error: 'Both conversationId and conversationData are required' 
            });
        }
        
        const analyzer = csvProcessor.analyzer;
        
        // First analyze the conversation
        const analysis = await analyzer.analyzeConversation(conversationId, conversationData);
        
        // Then generate the goal
        const goal = await analyzer.generateGoalFromConversation(analysis, {
            conversation_id: conversationId,
            conversation_data: conversationData
        });
        
        res.json({
            analysis,
            generatedGoal: goal
        });
    } catch (error) {
        console.error('Error generating goal:', error);
        res.status(400).json({ error: error.message });
    }
});

// Import endpoint - combines upload and processing for project-specific imports
router.post('/import', upload.single('csvFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No CSV file uploaded' });
        }

        const options = {
            generateGoals: req.body.generateGoals !== 'false',
            batchSize: parseInt(req.body.batchSize) || 10,
            projectId: req.body.projectId
        };

        console.log(`Processing CSV import: ${req.file.originalname} (${req.file.size} bytes) for project ${options.projectId}`);
        
        const result = await csvProcessor.processUpload(req.file.path, options);
        
        // Clean up uploaded file
        fs.unlinkSync(req.file.path);
        
        res.json({
            success: true,
            jobId: result.jobId,
            summary: result.summary,
            estimatedTime: result.estimatedTime,
            parseErrors: result.parseErrors
        });
    } catch (error) {
        console.error('CSV import error:', error);
        
        // Clean up file if it exists
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        res.status(400).json({ 
            error: error.message,
            details: error.stack 
        });
    }
});

// Route aliases for import endpoints to match frontend expectations
router.get('/import/:jobId/status', (req, res) => {
    try {
        const status = csvProcessor.getJobStatus(req.params.jobId);
        
        if (status.error) {
            return res.status(404).json(status);
        }
        
        res.json(status);
    } catch (error) {
        console.error('Error getting import job status:', error);
        res.status(500).json({ error: 'Failed to get job status' });
    }
});

router.get('/import/:jobId/results', (req, res) => {
    try {
        const includeDetails = req.query.details === 'true';
        const results = csvProcessor.getJobResults(req.params.jobId, includeDetails);
        
        if (results.error) {
            return res.status(404).json(results);
        }
        
        res.json(results);
    } catch (error) {
        console.error('Error getting import job results:', error);
        res.status(500).json({ error: 'Failed to get job results' });
    }
});

// Cleanup old jobs (can be called manually or scheduled)
router.post('/cleanup', (req, res) => {
    try {
        const maxAge = parseInt(req.body.maxAge) || (24 * 60 * 60 * 1000); // 24 hours default
        csvProcessor.cleanupOldJobs(maxAge);
        
        res.json({ success: true, message: 'Cleanup completed' });
    } catch (error) {
        console.error('Error during cleanup:', error);
        res.status(500).json({ error: 'Cleanup failed' });
    }
});

// Error handling middleware for multer
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
        }
    }
    
    if (error.message === 'Only CSV files are allowed') {
        return res.status(400).json({ error: error.message });
    }
    
    next(error);
});

module.exports = router;