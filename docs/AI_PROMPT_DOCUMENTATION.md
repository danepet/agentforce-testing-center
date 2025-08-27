# AI Testing Agent Prompt Documentation

## Overview

The AI Testing Agent uses OpenAI's GPT-4 model with four distinct prompt types to automate the testing of Salesforce Agentforce AI interactions. Each prompt type serves a specific purpose in the testing workflow and uses carefully crafted instructions to guide the AI toward achieving reliable, measurable test results.

## System Configuration

- **Model**: GPT-4
- **Temperature**: 0.7 (for conversation generation and responses), 0.3 (for analysis tasks)
- **Max Tokens**: Varies by prompt type (300-1500)
- **API**: OpenAI Chat Completions

## Prompt Categories

### 1. Conversation Plan Generation

**Purpose**: Creates a structured test plan with 3-5 conversation messages designed to guide the Agentforce AI toward achieving a specific goal.

**Temperature**: 0.7 (encourages creative but controlled variation)
**Max Tokens**: 1500
**Expected Output**: JSON array of conversation steps

**System Message**: 
```
You are an expert at designing test conversations for Salesforce AI agents. Always respond with valid JSON.
```

**User Prompt Template**:
```
You are a testing agent that will interact with a Salesforce Agentforce AI to validate if a specific goal can be achieved.

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
]
```

**Key Features**:
- Generates realistic user conversation flows
- Includes expected response patterns for validation
- Adapts to specific goal requirements and validation criteria
- Creates natural, human-like interaction patterns

---

### 2. Response Generation

**Purpose**: Generates appropriate follow-up responses during active conversations based on Agentforce responses and conversation history.

**Temperature**: 0.7 (maintains conversational variety)
**Max Tokens**: 500
**Expected Output**: Plain text response or status indicator

**System Message**:
```
You are a testing agent that interacts naturally with Salesforce AI agents to validate goal completion.
```

**User Prompt Template**:
```
You are a testing agent validating if a Salesforce Agentforce AI can achieve a specific goal.

Goal: ${goal.name}
Description: ${goal.description}

Conversation so far:
${conversationHistory.map(msg => `${msg.sender}: ${msg.message}`).join('\n')}

Latest Agentforce response: ${agentforceResponse}

Based on the conversation and the Agentforce response, generate your next message to continue working toward the goal. 

If the goal appears to be achieved, respond with: "GOAL_ACHIEVED: [brief explanation]"
If the goal cannot be achieved, respond with: "GOAL_FAILED: [brief explanation]"
Otherwise, provide a natural follow-up message to continue the conversation.

Keep your response concise and realistic.
```

**Key Features**:
- Adapts responses based on conversation context
- Recognizes goal completion or failure states
- Maintains natural conversation flow
- Provides clear status indicators for automated processing

---

### 3. Success Analysis

**Purpose**: Analyzes completed conversations and Salesforce data changes to determine goal achievement and provide detailed scoring.

**Temperature**: 0.3 (prioritizes accuracy and consistency)
**Max Tokens**: 1000
**Expected Output**: Structured JSON analysis

**System Message**:
```
You are an expert at analyzing AI agent conversations and Salesforce data changes. Always respond with valid JSON.
```

**User Prompt Template**:
```
Analyze if the following conversation successfully achieved the specified goal.

Goal: ${goal.name}
Description: ${goal.description}
Validation Criteria: ${goal.validationCriteria ? goal.validationCriteria.join(', ') : 'Not specified'}

Conversation History:
${conversationHistory.map(msg => `${msg.sender}: ${msg.message}`).join('\n')}

Salesforce Data Before: ${JSON.stringify(salesforceDataBefore, null, 2)}
Salesforce Data After: ${JSON.stringify(salesforceDataAfter, null, 2)}

Analyze the conversation and data changes to determine:
1. Was the goal achieved? (true/false)
2. What percentage of validation criteria were met? (0-100)
3. What specific actions were completed?
4. What data was created/modified in Salesforce?
5. Any issues or failures?

Return your analysis as JSON:
{
  "goalAchieved": boolean,
  "score": number,
  "completedActions": [string],
  "salesforceChanges": [string],
  "issues": [string],
  "summary": "Brief explanation of results"
}
```

**Key Features**:
- Compares before/after Salesforce data states
- Provides objective scoring based on validation criteria
- Identifies specific completed actions and data changes
- Highlights issues or failures for debugging
- Returns structured data for automated processing

---

### 4. Continuation Evaluation

**Purpose**: Determines whether a conversation should continue or end based on interaction quality and goal progress.

**Temperature**: 0.3 (ensures consistent decision-making)
**Max Tokens**: 300
**Expected Output**: JSON decision with reasoning

**System Message**:
```
You are an expert at evaluating AI conversation quality and goal achievement. Always respond with valid JSON.
```

**User Prompt Template**:
```
You are evaluating whether a conversation with an Agentforce AI should continue or end.

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
}
```

**Key Features**:
- Evaluates conversation quality and progress
- Prevents infinite loops and poor user experiences
- Provides clear reasoning for decisions
- Includes conversation quality assessment
- Has fallback logic for error conditions (defaults to continue with length limit)

## Error Handling

Each prompt type includes robust error handling:

- **JSON Parsing Errors**: All prompts that expect JSON output include try-catch blocks
- **API Failures**: Network and API errors are logged and handled gracefully
- **Fallback Behavior**: Critical functions like continuation evaluation have default behaviors
- **Validation**: Response formats are validated before processing

## Validation Mechanisms

The system includes several validation layers:

1. **Response Format Validation**: JSON responses are parsed and validated
2. **Content Validation**: Responses are checked for required fields and appropriate content
3. **Goal Achievement Detection**: Special markers ("GOAL_ACHIEVED", "GOAL_FAILED") trigger state changes
4. **Data Change Analysis**: Before/after Salesforce data comparison provides objective validation
5. **Quality Assessment**: Conversation quality is continuously monitored

## Scoring System

The success analysis prompt generates scores based on:

- **Goal Achievement**: Primary binary indicator (true/false)
- **Validation Criteria Coverage**: Percentage of defined criteria met (0-100)
- **Action Completion**: Count and quality of completed actions
- **Data Changes**: Measurable changes in Salesforce state
- **Issue Detection**: Identification of failures or problems

## Best Practices

1. **Clear Goal Definition**: Well-defined goals with specific validation criteria produce better results
2. **Realistic Conversation Flow**: Prompts encourage natural, human-like interactions
3. **Objective Measurement**: Data-driven validation reduces subjective interpretation
4. **Error Recovery**: Robust error handling prevents test failures from system issues
5. **Progressive Complexity**: Conversations can escalate complexity as needed

## Usage Notes

- All prompts are designed to work with GPT-4's capabilities and limitations
- Temperature settings balance creativity (conversation) with accuracy (analysis)
- Token limits are set based on expected response complexity
- System messages provide consistent behavioral context across all prompts
- Error handling ensures graceful degradation when AI responses are unexpected

This documentation provides a comprehensive understanding of how the AI Testing Agent uses sophisticated prompt engineering to create reliable, automated testing of Salesforce Agentforce interactions.