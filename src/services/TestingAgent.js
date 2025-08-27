const OpenAI = require('openai');

class TestingAgent {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  /**
   * Extract realistic data from conversation or generate fake data
   */
  generateRealisticData(sourceConversation) {
    const data = {
      names: ['Sarah Chen', 'Michael Rodriguez', 'Jennifer Williams', 'David Park', 'Amanda Thompson', 'James Miller', 'Lisa Jackson', 'Robert Kim', 'Maria Garcia', 'Thomas Anderson'],
      emails: ['sarah.chen47@gmail.com', 'mike.rodriguez.tech@yahoo.com', 'j.williams2024@outlook.com', 'davidp.consulting@protonmail.com', 'amanda.t.creative@gmail.com'],
      phones: ['(425) 867-2349', '(512) 394-7621', '(617) 283-9405', '(303) 756-1892', '(904) 428-3067'],
      orderIds: ['ORD-2024-7829', 'SO-240826-1493', 'PO-AUG-5729', 'REF-240826-8374', 'INV-082624-2951'],
      accountIds: ['ACC-47291', 'CUST-83746', 'USR-29847', 'ID-583729', 'ACCT-94726'],
      companies: ['Brightwell Consulting', 'TechFlow Solutions', 'Meridian Creative', 'Peak Performance Partners', 'Synthesis Digital']
    };

    let extractedData = {};
    
    if (sourceConversation) {
      // Try to extract real data from source conversation
      const text = sourceConversation.toLowerCase();
      
      // Extract emails
      const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
      const emails = sourceConversation.match(emailRegex);
      if (emails && emails.length > 0) {
        extractedData.email = emails[0];
      }
      
      // Extract phone numbers
      const phoneRegex = /(\+?1?[-.\s]?)?(\([0-9]{3}\)|[0-9]{3})[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g;
      const phones = sourceConversation.match(phoneRegex);
      if (phones && phones.length > 0) {
        extractedData.phone = phones[0];
      }
      
      // Extract names (look for "my name is", "I'm", "this is" patterns)
      const namePatterns = [
        /(?:my name is|i'm|this is|i am)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/gi,
        /hi,?\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/gi
      ];
      for (const pattern of namePatterns) {
        const match = pattern.exec(sourceConversation);
        if (match && match[1] && match[1].length > 2) {
          extractedData.name = match[1].trim();
          break;
        }
      }
      
      // Extract order/account IDs
      const idPatterns = [
        /(?:order|account|reference|invoice|case)[\s#:]*([a-zA-Z0-9-_]+)/gi,
        /#([a-zA-Z0-9-_]{4,})/g
      ];
      for (const pattern of idPatterns) {
        const match = pattern.exec(sourceConversation);
        if (match && match[1]) {
          extractedData.orderId = match[1];
          break;
        }
      }
    }
    
    // Fill in missing data with realistic fake data
    return {
      name: extractedData.name || data.names[Math.floor(Math.random() * data.names.length)],
      email: extractedData.email || data.emails[Math.floor(Math.random() * data.emails.length)],
      phone: extractedData.phone || data.phones[Math.floor(Math.random() * data.phones.length)],
      orderId: extractedData.orderId || data.orderIds[Math.floor(Math.random() * data.orderIds.length)],
      accountId: data.accountIds[Math.floor(Math.random() * data.accountIds.length)],
      company: data.companies[Math.floor(Math.random() * data.companies.length)]
    };
  }

  async generateInitialMessage(goal, sourceConversationData = null) {
    const goalSteps = goal.steps ? goal.steps.join(', ') : 'Not specified';
    const validationCriteria = goal.validationCriteria ? goal.validationCriteria.join(', ') : 'Not specified';
    
    // Generate realistic data
    const customerData = this.generateRealisticData(sourceConversationData);
    
    const prompt = `You are pretending to be a real customer reaching out for help. Write like a normal person would actually text or chat - casual, natural, maybe a bit rushed.

Goal: ${goal.name}
Description: ${goal.description}
Steps to work toward: ${goalSteps}

Your customer persona:
- Name: ${customerData.name}
- Email: ${customerData.email}
- Phone: ${customerData.phone}
- Order/Account ID: ${customerData.orderId}
- Company: ${customerData.company}

Use these realistic details naturally in your message if relevant. Don't force them all in, but use what makes sense for the conversation context.

Write your first message like a real customer would. Keep it:
- Short and natural (not formal or AI-like)
- How someone actually talks in chat
- Maybe a bit informal or casual
- Like you're texting a friend who works there
- Use realistic details when they fit naturally

Examples of good casual style with realistic data:
- "hey, having an issue with my order ORD-2024-7829"
- "hi! my name is Sarah and I need some help with something"
- "quick question about my account - this is mike.rodriguez.tech@yahoo.com"

Return only what you'd actually type - no quotes, no explanation.`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are a real customer writing casual, natural chat messages. Write like you text - short, informal, human. No AI or corporate speak."
          },
          {
            role: "user", 
            content: prompt
          }
        ],
        temperature: 0.8,
        max_tokens: 300
      });

      return completion.choices[0].message.content.trim();
    } catch (error) {
      console.error('Error generating initial message:', error);
      throw new Error('Failed to generate initial message');
    }
  }

  async generateConversationPlan(goal) {
    const prompt = `You are a testing agent that will interact with a Salesforce Agentforce AI to validate if a specific goal can be achieved.

Goal: ${goal.name}
Description: ${goal.description}
Steps to achieve: ${goal.steps ? goal.steps.join(', ') : 'Not specified'}
Validation criteria: ${goal.validationCriteria ? goal.validationCriteria.join(', ') : 'Not specified'}

Generate a conversation plan with 3-5 messages that you would send to the Agentforce AI to guide it toward achieving this goal. Each message should be natural and realistic, as if coming from a real user.

Return your response as a JSON array of conversation messages, where each message has:
- "intent": Brief description of what this message aims to accomplish
- "message": The actual message to send to Agentforce
- "expectedResponse": What kind of response you expect from Agentforce

Example format:
[
  {
    "intent": "Initial request",
    "message": "Hi, I need help with creating a new case for a customer issue",
    "expectedResponse": "Agentforce should offer to help create a case and ask for details"
  }
]`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are an expert at designing test conversations for Salesforce AI agents. Always respond with valid JSON."
          },
          {
            role: "user", 
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 1500
      });

      const response = completion.choices[0].message.content;
      return JSON.parse(response);
    } catch (error) {
      console.error('Error generating conversation plan:', error);
      throw new Error('Failed to generate conversation plan');
    }
  }

  async generateResponse(conversationHistory, goal, agentforceResponse, customerData = null, sourceConversationData = null) {
    const goalSteps = goal.steps ? goal.steps.join(', ') : 'Not specified';
    const validationCriteria = goal.validationCriteria ? goal.validationCriteria.join(', ') : 'Not specified';
    
    // Use existing customer data or generate new if not provided
    if (!customerData) {
      customerData = this.generateRealisticData(sourceConversationData);
    }
    
    const prompt = `You're a real customer continuing a chat conversation. Write like how people actually text - casual, short, natural.

What you're trying to get help with: ${goal.name}
${goal.description}
Steps you might need to take: ${goalSteps}

Your consistent customer persona (use when relevant):
- Name: ${customerData.name}
- Email: ${customerData.email}
- Phone: ${customerData.phone}
- Order/Account ID: ${customerData.orderId}
- Company: ${customerData.company}

Conversation so far:
${conversationHistory.map(msg => `${msg.sender}: ${msg.message}`).join('\n')}

They just said: ${agentforceResponse}

Now respond like a real person would. Keep it:
- Short and casual (not formal)
- Natural conversation flow
- How you'd actually text back
- Maybe use "ok", "yeah", "thanks", "got it" - normal chat words
- Don't be overly polite or AI-sounding
- Use realistic details from your persona when asked or when it fits naturally
- Stay consistent with the persona details throughout the conversation

If they ask for personal info (name, email, phone, order #), use your realistic data.
If they solved your problem: "GOAL_ACHIEVED: [brief explanation]"
If they clearly can't help after trying: "GOAL_FAILED: [brief explanation]"
Otherwise: Just respond naturally to what they said

Examples of good casual responses:
- "ok great, what do I need to do?"
- "yeah that makes sense"  
- "hmm not sure I follow"
- "perfect thanks!"
- "it's sarah.chen47@gmail.com"
- "my order number is ORD-2024-7829"

Write like you're texting a friend who works there.`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are a real customer texting casually. Write short, natural messages like people actually chat. No formal language or AI speak."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.8,
        max_tokens: 200
      });

      return completion.choices[0].message.content.trim();
    } catch (error) {
      console.error('Error generating response:', error);
      throw new Error('Failed to generate response');
    }
  }

  async analyzeConversationSuccess(goal, conversationHistory, salesforceDataBefore, salesforceDataAfter) {
    const prompt = `Analyze if the following conversation successfully achieved the specified goal.

Goal: ${goal.name}
Description: ${goal.description}
Validation Criteria: ${goal.validationCriteria ? goal.validationCriteria.join(', ') : 'Not specified'}

Conversation History:
${conversationHistory.map(msg => `${msg.sender}: ${msg.message}`).join('\n')}

Analyze the conversation to determine:
1. Was the goal achieved? (true/false)
2. What percentage of validation criteria were met? (0-100)
3. What specific actions were completed?
4. Any issues or failures?

Return your analysis as JSON:
{
  "goalAchieved": boolean,
  "score": number,
  "completedActions": [string],
  "issues": [string],
  "summary": "Brief explanation of results"
}`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are an expert at analyzing AI agent conversations. Always respond with valid JSON."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 1000
      });

      const response = completion.choices[0].message.content;
      return JSON.parse(response);
    } catch (error) {
      console.error('Error analyzing conversation:', error);
      throw new Error('Failed to analyze conversation');
    }
  }

  async evaluateConversationContinue(goal, conversationHistory, currentIntent) {
    const prompt = `You are evaluating whether a conversation with an Agentforce AI should continue or end.

Goal: ${goal.name}
Description: ${goal.description}
Current Intent: ${currentIntent}

Recent Conversation:
${conversationHistory.slice(-6).map(msg => `${msg.sender}: ${msg.message}`).join('\n')}

Analyze the conversation and determine if it should continue. The conversation should END if any of these conditions are met:
1. The goal has been successfully achieved
2. The AI Agent provided an unhelpful or incorrect response  
3. The AI Agent seems confused or unable to help
4. The conversation is going in circles or stuck
5. The AI Agent made an error or gave bad advice
6. The user experience would be considered poor

The conversation should CONTINUE if:
- Progress is being made toward the goal
- The AI Agent is being helpful and responsive
- More steps are needed to complete the goal
- The interaction is positive and productive

Return your evaluation as JSON:
{
  "continue": boolean,
  "reason": "Brief explanation of why to continue or stop",
  "assessment": "positive/negative/neutral - overall interaction quality"
}`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are an expert at evaluating AI conversation quality and goal achievement. Always respond with valid JSON."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 300
      });

      const response = completion.choices[0].message.content;
      return JSON.parse(response);
    } catch (error) {
      console.error('Error evaluating conversation continuation:', error);
      // Default to continue on error, but limit to prevent infinite loops
      return {
        continue: conversationHistory.length < 8,
        reason: "Error in evaluation - defaulting to continue with length limit",
        assessment: "neutral"
      };
    }
  }
}

module.exports = TestingAgent;