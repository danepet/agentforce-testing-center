const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { parse } = require('csv-parse/sync');
const ConversationAnalyzer = require('./ConversationAnalyzer');
const Project = require('../models/Project');

class CSVProcessor {
    constructor() {
        this.analyzer = new ConversationAnalyzer();
        this.uploadDir = process.env.UPLOAD_DIR || './uploads';
        this.ensureUploadDir();
        
        // Track processing jobs
        this.processingJobs = new Map();
    }

    ensureUploadDir() {
        if (!fs.existsSync(this.uploadDir)) {
            fs.mkdirSync(this.uploadDir, { recursive: true });
        }
    }

    /**
     * Parse CSV content and validate structure
     */
    parseCSV(csvContent) {
        try {
            console.log(`[CSV Processor] Starting CSV parsing...`);
            
            // Parse CSV using csv-parse library which handles quotes, escaping, etc properly
            const records = parse(csvContent, {
                columns: true, // Use first line as header
                skip_empty_lines: true,
                trim: true,
                relax_column_count: true // Allow different column counts
            });
            
            console.log(`[CSV Processor] Raw CSV parsed, ${records.length} records found`);
            
            if (records.length === 0) {
                throw new Error('CSV must contain at least one data row');
            }

            const header = Object.keys(records[0]);
            console.log(`[CSV Processor] CSV headers:`, header);
            
            // Validate required columns (flexible column names)
            const requiredColumns = ['conversation_id'];
            const conversationDataColumn = header.find(col => 
                col.toLowerCase().includes('conversation') && !col.toLowerCase().includes('id')
            );
            
            if (!conversationDataColumn) {
                throw new Error('CSV must contain a conversation data column (e.g., conversation_data, conversation_json, conversation_text, etc.)');
            }
            
            console.log(`[CSV Processor] Using conversation data column: ${conversationDataColumn}`);
            
            const missingColumns = requiredColumns.filter(col => !header.includes(col));
            
            if (missingColumns.length > 0) {
                throw new Error(`Missing required columns: ${missingColumns.join(', ')}`);
            }

            const conversations = [];
            const errors = [];

            records.forEach((record, index) => {
                try {
                    // Just validate that conversation data exists (can be any format)
                    const conversationData = record[conversationDataColumn];
                    if (conversationData && conversationData.trim()) {
                        // Normalize the conversation data field name for consistency
                        record.conversation_data = conversationData;
                        conversations.push(record);
                    } else {
                        errors.push({
                            line: index + 2, // +2 because header is line 1
                            conversationId: record.conversation_id,
                            error: 'Empty or missing conversation data'
                        });
                    }
                } catch (rowError) {
                    errors.push({
                        line: index + 2,
                        error: `Row processing error: ${rowError.message}`
                    });
                }
            });

            console.log(`[CSV Processor] CSV parsing completed: ${conversations.length} valid conversations, ${errors.length} errors`);

            return {
                conversations,
                errors,
                summary: {
                    totalRows: records.length,
                    validConversations: conversations.length,
                    errorCount: errors.length,
                    successRate: (conversations.length / records.length) * 100
                }
            };
        } catch (error) {
            console.error(`[CSV Processor] CSV parsing failed:`, error.message);
            throw new Error(`CSV parsing error: ${error.message}`);
        }
    }


    /**
     * Process uploaded CSV file
     */
    async processUpload(filePath, options = {}) {
        try {
            console.log(`[CSV Processor] Starting upload processing for file: ${filePath}`);
            console.log(`[CSV Processor] Options:`, JSON.stringify(options, null, 2));
            
            const csvContent = fs.readFileSync(filePath, 'utf8');
            console.log(`[CSV Processor] File read successfully, size: ${csvContent.length} characters`);
            
            const parseResult = this.parseCSV(csvContent);
            console.log(`[CSV Processor] Parsing completed. Found ${parseResult.conversations.length} conversations, ${parseResult.errors.length} errors`);
            
            if (parseResult.conversations.length === 0) {
                console.error(`[CSV Processor] No valid conversations found in CSV`);
                throw new Error('No valid conversations found in CSV');
            }

            // Create processing job
            const jobId = uuidv4();
            const job = {
                id: jobId,
                status: 'initialized',
                totalConversations: parseResult.conversations.length,
                processedCount: 0,
                analysisResults: [],
                generatedGoals: [],
                errors: parseResult.errors,
                startTime: new Date(),
                options: {
                    generateGoals: options.generateGoals !== false,
                    batchSize: options.batchSize || 10,
                    ...options
                }
            };

            this.processingJobs.set(jobId, job);
            console.log(`[CSV Processor] Created job ${jobId} for ${parseResult.conversations.length} conversations`);

            // Start processing asynchronously
            console.log(`[CSV Processor] Starting async processing for job ${jobId}`);
            this.processConversationsAsync(jobId, parseResult.conversations);

            return {
                jobId,
                summary: parseResult.summary,
                estimatedTime: this.estimateProcessingTime(parseResult.conversations.length),
                parseErrors: parseResult.errors
            };
        } catch (error) {
            throw new Error(`Upload processing failed: ${error.message}`);
        }
    }

    /**
     * Process conversations asynchronously
     */
    async processConversationsAsync(jobId, conversations) {
        console.log(`[CSV Processor] processConversationsAsync started for job ${jobId}`);
        const job = this.processingJobs.get(jobId);
        if (!job) {
            console.error(`[CSV Processor] Job ${jobId} not found in processing jobs`);
            return;
        }

        try {
            console.log(`[CSV Processor] Setting job ${jobId} status to 'analyzing'`);
            job.status = 'analyzing';
            
            // Load project information if projectId is provided
            let project = null;
            if (job.options.projectId) {
                console.log(`[CSV Processor] Loading project ${job.options.projectId}`);
                try {
                    project = await Project.findById(job.options.projectId);
                    console.log(`[CSV Processor] Project loaded: ${project ? project.name : 'null'}`);
                } catch (error) {
                    console.warn(`[CSV Processor] Could not load project ${job.options.projectId}:`, error.message);
                }
            }
            
            const batchSize = job.options.batchSize;
            const batches = this.chunkArray(conversations, batchSize);
            console.log(`[CSV Processor] Job ${jobId}: Processing ${conversations.length} conversations in ${batches.length} batches of ${batchSize}`);

            for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
                const batch = batches[batchIndex];
                console.log(`[CSV Processor] Job ${jobId}: Processing batch ${batchIndex + 1}/${batches.length} with ${batch.length} conversations`);
                
                // Process batch in parallel
                const batchPromises = batch.map(async (conversation, index) => {
                    console.log(`[CSV Processor] Job ${jobId}: Processing conversation ${conversation.conversation_id}`);
                    try {
                        console.log(`[CSV Processor] Job ${jobId}: Starting analysis for conversation ${conversation.conversation_id}`);
                        const analysis = await this.analyzer.analyzeConversation(
                            conversation.conversation_id,
                            conversation.conversation_data
                        );
                        console.log(`[CSV Processor] Job ${jobId}: Analysis completed for conversation ${conversation.conversation_id}`);

                        let generatedGoal = null;
                        if (job.options.generateGoals) {
                            console.log(`[CSV Processor] Job ${jobId}: Generating goal for conversation ${conversation.conversation_id}`);
                            generatedGoal = await this.analyzer.generateGoalFromConversation(
                                analysis,
                                conversation,
                                project
                            );
                            console.log(`[CSV Processor] Job ${jobId}: Goal generated for conversation ${conversation.conversation_id}`);
                        }

                        return {
                            conversationId: conversation.conversation_id,
                            analysis,
                            generatedGoal,
                            success: true
                        };
                    } catch (error) {
                        console.error(`[CSV Processor] Job ${jobId}: Error processing conversation ${conversation.conversation_id}:`, error.message);
                        return {
                            conversationId: conversation.conversation_id,
                            error: error.message,
                            success: false
                        };
                    }
                });

                const batchResults = await Promise.allSettled(batchPromises);
                console.log(`[CSV Processor] Job ${jobId}: Batch ${batchIndex + 1} completed, processing results`);
                
                // Process batch results
                let successCount = 0;
                let errorCount = 0;
                batchResults.forEach((result, index) => {
                    if (result.status === 'fulfilled' && result.value.success) {
                        job.analysisResults.push(result.value.analysis);
                        if (result.value.generatedGoal) {
                            job.generatedGoals.push(result.value.generatedGoal);
                        }
                        successCount++;
                    } else {
                        job.errors.push({
                            conversationId: result.value?.conversationId || batch[index].conversation_id,
                            error: result.value?.error || result.reason?.message || 'Unknown error',
                            stage: 'analysis'
                        });
                        errorCount++;
                    }
                    job.processedCount++;
                });

                console.log(`[CSV Processor] Job ${jobId}: Batch ${batchIndex + 1} results - ${successCount} success, ${errorCount} errors`);
                
                // Update job progress
                job.progress = (job.processedCount / job.totalConversations) * 100;
                console.log(`[CSV Processor] Job ${jobId}: Progress ${Math.round(job.progress)}% (${job.processedCount}/${job.totalConversations})`);
                
                // Update status to processing if not already
                if (job.status !== 'processing') {
                    job.status = 'processing';
                    console.log(`[CSV Processor] Job ${jobId}: Status changed to 'processing'`);
                }
                
                // Small delay between batches to prevent overwhelming the API
                if (batchIndex < batches.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            // Finalize job
            console.log(`[CSV Processor] Job ${jobId}: All batches completed, finalizing job`);
            job.status = 'completed';
            job.endTime = new Date();
            job.processingTime = job.endTime - job.startTime;
            job.summary = this.generateJobSummary(job);
            console.log(`[CSV Processor] Job ${jobId}: Completed successfully in ${Math.round(job.processingTime / 1000)}s`);
            console.log(`[CSV Processor] Job ${jobId}: Final results - ${job.analysisResults.length} analyses, ${job.generatedGoals.length} goals, ${job.errors.length} errors`);

        } catch (error) {
            console.error(`[CSV Processor] Job ${jobId}: Fatal error during processing:`, error.message);
            console.error(`[CSV Processor] Job ${jobId}: Stack trace:`, error.stack);
            job.status = 'failed';
            job.error = error.message;
            job.endTime = new Date();
        }
    }

    /**
     * Get job status and progress
     */
    getJobStatus(jobId) {
        const job = this.processingJobs.get(jobId);
        if (!job) {
            console.log(`[CSV Processor] getJobStatus: Job ${jobId} not found`);
            return { error: 'Job not found' };
        }

        const status = {
            id: job.id,
            status: job.status,
            progress: job.progress || 0,
            processed: job.processedCount,
            total: job.totalConversations,
            startTime: job.startTime,
            endTime: job.endTime,
            processingTime: job.processingTime,
            summary: job.summary,
            errorCount: job.errors.length
        };
        
        console.log(`[CSV Processor] getJobStatus: Job ${jobId} status - ${status.status}, progress: ${Math.round(status.progress)}%`);
        return status;
    }

    /**
     * Get job results
     */
    getJobResults(jobId, includeDetails = false) {
        const job = this.processingJobs.get(jobId);
        if (!job) {
            return { error: 'Job not found' };
        }

        const result = {
            id: job.id,
            status: job.status,
            summary: job.summary || this.generateJobSummary(job),
            generatedGoals: job.generatedGoals,
            errorCount: job.errors.length
        };

        if (includeDetails) {
            result.analysisResults = job.analysisResults;
            result.errors = job.errors;
            result.processingTime = job.processingTime;
        }

        return result;
    }

    /**
     * Generate analytics from conversation analysis
     */
    generateAnalytics(analysisResults) {
        if (!analysisResults || analysisResults.length === 0) {
            return { error: 'No analysis results available' };
        }

        const analytics = {
            totalConversations: analysisResults.length,
            categoryDistribution: {},
            complexityDistribution: { Low: 0, Medium: 0, High: 0 },
            resolutionDistribution: {},
            averageComplexity: 0,
            patternDistribution: {},
            emotionalToneDistribution: {},
            processingMetrics: {
                avgProcessingTime: 0,
                successRate: 0
            }
        };

        let totalComplexity = 0;

        analysisResults.forEach(analysis => {
            // Category distribution
            const category = analysis.category || 'uncategorized';
            analytics.categoryDistribution[category] = (analytics.categoryDistribution[category] || 0) + 1;

            // Complexity distribution
            const complexity = analysis.complexity?.level || 'Medium';
            analytics.complexityDistribution[complexity]++;
            totalComplexity += analysis.complexity?.score || 50;

            // Resolution distribution
            const resolution = analysis.resolution || 'unknown';
            analytics.resolutionDistribution[resolution] = (analytics.resolutionDistribution[resolution] || 0) + 1;

            // Pattern distribution
            const pattern = analysis.conversationPattern?.primary || 'unknown';
            analytics.patternDistribution[pattern] = (analytics.patternDistribution[pattern] || 0) + 1;

            // Emotional tone distribution
            const tone = analysis.emotionalTone?.overall || 'neutral';
            analytics.emotionalToneDistribution[tone] = (analytics.emotionalToneDistribution[tone] || 0) + 1;
        });

        analytics.averageComplexity = totalComplexity / analysisResults.length;

        return analytics;
    }

    /**
     * Utility methods
     */
    chunkArray(array, chunkSize) {
        const chunks = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    }

    estimateProcessingTime(conversationCount) {
        // Rough estimate: 2-3 seconds per conversation for analysis + goal generation
        const baseTimePerConversation = 2.5; // seconds
        const estimatedSeconds = conversationCount * baseTimePerConversation;
        
        return {
            seconds: estimatedSeconds,
            formatted: this.formatDuration(estimatedSeconds * 1000)
        };
    }

    formatDuration(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    generateJobSummary(job) {
        const successfulAnalyses = job.analysisResults.length;
        const successfulGoals = job.generatedGoals.length;
        
        return {
            totalProcessed: job.processedCount,
            successfulAnalyses,
            successfulGoals,
            errorCount: job.errors.length,
            successRate: (successfulAnalyses / job.totalConversations) * 100,
            goalGenerationRate: job.options.generateGoals ? (successfulGoals / successfulAnalyses) * 100 : null,
            processingTime: job.processingTime ? this.formatDuration(job.processingTime) : null
        };
    }


    /**
     * Clean up old jobs (call periodically)
     */
    cleanupOldJobs(maxAge = 24 * 60 * 60 * 1000) { // 24 hours default
        const cutoff = new Date(Date.now() - maxAge);
        
        for (const [jobId, job] of this.processingJobs.entries()) {
            if (job.startTime < cutoff) {
                this.processingJobs.delete(jobId);
            }
        }
    }
}

module.exports = CSVProcessor;