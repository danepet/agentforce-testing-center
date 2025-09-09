const OpenAI = require('openai');

class ConversationAnalyzer {
    constructor() {
        const apiKey = process.env.OPENAI_API_KEY;
        console.log('OPENAI_API_KEY present:', !!apiKey);
        console.log('OPENAI_API_KEY length:', apiKey ? apiKey.length : 0);
        
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required but not set');
        }
        
        this.openai = new OpenAI({
            apiKey: apiKey
        });
    }

    /**
     * Analyze a single conversation from CSV data (any format)
     */
    async analyzeConversation(conversationId, conversationData) {
        try {
            // Use AI to analyze the raw conversation data directly
            const analysis = await this.analyzeConversationWithAI(conversationId, conversationData);
            return analysis;
        } catch (error) {
            console.error(`Error analyzing conversation ${conversationId}:`, error);
            throw new Error(`Failed to analyze conversation: ${error.message}`);
        }
    }

    /**
     * Use AI to analyze conversation data in any format
     */
    async analyzeConversationWithAI(conversationId, conversationData) {
        try {
            const prompt = `
            Analyze this customer service conversation and extract key insights:

            CONVERSATION DATA:
            ${conversationData}

            Return JSON with this exact structure:
            {
                "id": "${conversationId}",
                "messageCount": estimated_number_of_messages,
                "category": "billing|technical|order|product|account|support|other",
                "resolution": "resolved|unresolved|escalated|pending|unknown",
                "complexity": {
                    "level": "Low|Medium|High",
                    "score": 0-100,
                    "factors": {
                        "technicalComplexity": 0-10,
                        "emotionalComplexity": 0-10,
                        "processComplexity": 0-10
                    }
                },
                "emotionalTone": {
                    "overall": "positive|negative|neutral|frustrated|satisfied",
                    "progression": ["initial_emotion", "final_emotion"],
                    "intensity": 1-10
                },
                "intentAnalysis": {
                    "primaryIntent": "brief description of main customer goal",
                    "urgency": "low|medium|high",
                    "actionRequired": "what needs to be done",
                    "successCriteria": ["what indicates resolution"]
                },
                "conversationPattern": {
                    "primary": "information_gathering|problem_solving|escalation|quick_resolution|complex_multi_step",
                    "confidence": 0.0-1.0
                },
                "summary": "brief summary of the conversation and outcome"
            }
            `;

            const completion = await this.openai.chat.completions.create({
                model: "gpt-4",
                messages: [
                    {
                        role: "system",
                        content: "You are an expert at analyzing customer service conversations. Always respond with valid JSON matching the specified schema."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.2,
                max_tokens: 1000
            });

            return JSON.parse(completion.choices[0].message.content);
        } catch (error) {
            console.error('Error in AI conversation analysis:', error);
            throw new Error(`AI analysis failed: ${error.message}`);
        }
    }

    /**
     * Generate test goals from analyzed conversation
     */
    async generateGoalFromConversation(conversationAnalysis, conversation, project = null) {
        try {
            const prompt = this.buildGoalGenerationPrompt(conversationAnalysis, conversation, project);
            
            const completion = await this.openai.chat.completions.create({
                model: "gpt-4",
                messages: [
                    {
                        role: "system",
                        content: "You are an expert at converting human customer service conversations into structured test goals for AI agents. Always respond with valid JSON matching the specified schema."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.3,
                max_tokens: 2000
            });

            const response = completion.choices[0].message.content;
            const generatedGoal = JSON.parse(response);

            // Add quality score
            generatedGoal.qualityScore = await this.scoreGoalQuality(generatedGoal, conversationAnalysis);
            generatedGoal.sourceConversationId = conversation.conversation_id;
            generatedGoal.sourceConversationData = conversation.conversation_data;
            generatedGoal.generatedAt = new Date().toISOString();

            return generatedGoal;
        } catch (error) {
            console.error('Error generating goal from conversation:', error);
            throw new Error(`Failed to generate goal: ${error.message}`);
        }
    }

    // Removed old assessComplexity method - now handled by AI

    // Removed old analyzeEmotionalTone method - now handled by AI

    // Removed old analyzeCustomerIntent method - now handled by AI

    // Removed old extractAgentActions method - now handled by AI

    // Removed old categorizePattern method - now handled by AI

    /**
     * Build the goal generation prompt
     */
    buildGoalGenerationPrompt(analysis, conversation, project = null) {
        // Use project-specific prompt if available, otherwise use default
        if (project && project.goalGenerationPrompt) {
            // Replace placeholders in the custom prompt
            return project.goalGenerationPrompt
                .replace(/\{analysis\.intentAnalysis\.primaryIntent\}/g, analysis.intentAnalysis.primaryIntent)
                .replace(/\{analysis\.category\}/g, analysis.category)
                .replace(/\{analysis\.complexity\.level\}/g, analysis.complexity.level)
                .replace(/\{analysis\.complexity\.score\}/g, analysis.complexity.score)
                .replace(/\{analysis\.resolution\}/g, analysis.resolution)
                .replace(/\{analysis\.emotionalTone\.overall\}/g, analysis.emotionalTone.overall)
                .replace(/\{analysis\.conversationPattern\.primary\}/g, analysis.conversationPattern.primary)
                .replace(/\{conversation\.conversation_data\}/g, conversation.conversation_data);
        }
        
        // Default prompt
        return `
        Convert this human customer service conversation into a test goal for an AI agent.

        CONVERSATION ANALYSIS:
        - Primary Intent: ${analysis.intentAnalysis.primaryIntent}
        - Category: ${analysis.category}
        - Complexity: ${analysis.complexity.level} (${analysis.complexity.score}/100)
        - Resolution: ${analysis.resolution}
        - Emotional Tone: ${analysis.emotionalTone.overall}
        - Pattern: ${analysis.conversationPattern.primary}

        ORIGINAL CONVERSATION:
        ${conversation.conversation_data}

        CRITICAL INSTRUCTIONS FOR GOAL GENERATION:

        1. EXTRACT CUSTOMER SCENARIO: Identify the specific customer situation, exact phrases they used, and data points mentioned (prices, products, dates, concerns).

        2. CREATE CUSTOMER-FOCUSED STEPS: The "steps" should describe what the TESTING AGENT should say/do to replicate the customer's journey. Use actual customer language and scenarios from the conversation. Steps should be goal-oriented but flexible to allow for different conversation paths.

        3. CONVERSATION-BASED VALIDATION: Focus validation criteria on what information should be provided, accuracy of details communicated, and quality of user experience. DO NOT validate generic AI behavior.

        Examples of GOOD steps (customer-focused):
        - "Ask about PRP treatment for hair restoration, mentioning you heard it costs around $800-1200"
        - "Express concerns about hair loss and ask if PRP is painful or has side effects"
        - "Request information about financing options or payment plans available"

        Examples of BAD steps (AI-focused):
        - "AI gathers necessary information"
        - "AI provides appropriate response"
        - "AI confirms resolution"

        Examples of GOOD validation criteria (conversation outcome-focused):
        - "Customer receives accurate PRP pricing information ($800-1200 range)"
        - "Customer is offered a free consultation to discuss hair restoration options"
        - "Conversation maintains empathetic tone when discussing hair loss concerns"

        Examples of BAD validation criteria (generic AI behavior):
        - "AI correctly identifies the customer's inquiry"
        - "AI maintains a neutral tone"
        - "AI provides accurate information"

        MANDATORY: You MUST extract specific details, phrases, prices, products, and concerns from the original conversation and use them in the steps and validation criteria. DO NOT use generic language.

        MANDATORY: Each step must be written from the customer's perspective describing what they will say or ask, using language similar to what was actually used in the original conversation.

        MANDATORY: Each validation criterion must specify exactly what information, prices, services, or outcomes should result from this specific customer scenario.

        Return JSON in this exact format:
        {
            "name": "Clear, specific goal name based on the actual customer scenario",
            "description": "Detailed description of what this test validates, referencing the specific customer situation",
            "category": "${analysis.category}",
            "complexity": "${analysis.complexity.level}",
            "steps": [
                "Specific customer action based on actual conversation content",
                "Follow-up customer request using real conversation details", 
                "Additional customer concerns from the actual scenario",
                "Final customer action requesting specific next steps"
            ],
            "validationCriteria": [
                "Customer receives specific information that was discussed in original conversation",
                "Customer is offered specific services mentioned in the conversation",
                "Conversation addresses the exact concerns raised in original scenario",
                "Customer gets accurate details about specific products/services/prices mentioned"
            ],
            "expectedOutcomes": [
                "Specific customer need is addressed with accurate information from the conversation",
                "Specific next steps are clearly communicated to customer", 
                "Customer feels satisfied and informed about their specific inquiry"
            ],
            "customerScenario": {
                "originalPhrases": ["Extract actual phrases the customer used in the conversation"],
                "specificDataPoints": ["Extract specific prices, products, dates, treatments, or other concrete details mentioned"],
                "emotionalContext": "Describe the customer's emotional state and specific concerns from the conversation",
                "customerGoal": "What the customer was ultimately trying to achieve based on the conversation"
            },
            "aiConsiderations": {
                "empathyRequired": true/false,
                "technicalKnowledge": "level required for this specific scenario",
                "escalationTriggers": ["conditions that require human handoff for this scenario"],
                "riskFactors": ["potential failure points specific to this customer situation"]
            },
            "metadata": {
                "sourceType": "human_conversation", 
                "originalResolution": "${analysis.resolution}",
                "emotionalComplexity": "${analysis.emotionalTone.overall}",
                "conversationSummary": "${analysis.summary || ''}"
            }
        }
        `;
    }

    /**
     * Score the quality of a generated goal
     */
    async scoreGoalQuality(goal, conversationAnalysis) {
        try {
            const criteria = {
                completeness: this.scoreCompleteness(goal),
                specificity: this.scoreSpecificity(goal),
                testability: this.scoreTestability(goal),
                aiSuitability: this.scoreAISuitability(goal),
                alignment: this.scoreAlignmentWithSource(goal, conversationAnalysis)
            };

            const overallScore = Object.values(criteria).reduce((sum, score) => sum + score, 0) / Object.keys(criteria).length;

            return {
                overall: Math.round(overallScore * 100) / 100,
                breakdown: criteria,
                recommendations: this.generateQualityRecommendations(criteria)
            };
        } catch (error) {
            console.error('Error scoring goal quality:', error);
            return { overall: 0.5, breakdown: {}, recommendations: [] };
        }
    }

    // Removed all old helper methods - analysis now handled by AI

    // Quality scoring methods
    scoreCompleteness(goal) {
        const required = ['name', 'description', 'steps', 'validationCriteria'];
        const present = required.filter(field => goal[field] && goal[field].length > 0).length;
        return present / required.length;
    }

    scoreSpecificity(goal) {
        const vague = ['thing', 'stuff', 'something', 'general', 'basic'];
        const description = (goal.description || '').toLowerCase();
        const hasVague = vague.some(word => description.includes(word));
        return hasVague ? 0.3 : 0.8;
    }

    scoreTestability(goal) {
        const testable = goal.validationCriteria && goal.validationCriteria.length >= 2;
        return testable ? 0.8 : 0.3;
    }

    scoreAISuitability(goal) {
        const aiUnfriendly = ['human judgment', 'emotional support', 'complex negotiation'];
        const description = (goal.description || '').toLowerCase();
        const hasUnfriendly = aiUnfriendly.some(phrase => description.includes(phrase));
        return hasUnfriendly ? 0.4 : 0.8;
    }

    scoreAlignmentWithSource(goal, analysis) {
        const categoryMatch = goal.category === analysis.category;
        const complexityMatch = goal.complexity === analysis.complexity.level;
        return (categoryMatch ? 0.5 : 0) + (complexityMatch ? 0.5 : 0);
    }

    generateQualityRecommendations(criteria) {
        const recommendations = [];
        
        if (criteria.completeness < 0.7) {
            recommendations.push('Add missing required fields (name, description, steps, or validation criteria)');
        }
        if (criteria.specificity < 0.7) {
            recommendations.push('Make the description more specific and detailed');
        }
        if (criteria.testability < 0.7) {
            recommendations.push('Add more measurable validation criteria');
        }
        if (criteria.aiSuitability < 0.7) {
            recommendations.push('Consider if this scenario is appropriate for AI testing');
        }
        
        return recommendations;
    }
}

module.exports = ConversationAnalyzer;