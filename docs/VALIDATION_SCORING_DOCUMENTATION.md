# Validation Prompts and Scoring Mechanisms Documentation

## Overview

This document details the validation and scoring systems used by the AI Testing Agent to measure goal achievement and conversation quality. The system combines AI-powered analysis with data-driven validation to provide objective, measurable test results.

## Validation Architecture

### Multi-Layer Validation Approach

1. **Conversation Analysis** - AI evaluates dialogue quality and goal progress
2. **Data State Comparison** - Before/after Salesforce data changes
3. **Criteria Matching** - Goal-specific validation requirements
4. **Quality Assessment** - Overall interaction evaluation

## Validation Criteria System

### Goal-Level Validation

Each goal includes user-defined validation criteria that specify measurable outcomes:

```javascript
// Example validation criteria
validationCriteria: [
  "Case record created in Salesforce",
  "Case has correct status",
  "Case assigned to appropriate queue",
  "Customer notification sent"
]
```

### Validation Types

1. **Data Validation**: Verifiable changes in Salesforce records
2. **Process Validation**: Completion of specific workflow steps
3. **Quality Validation**: Appropriate responses and guidance
4. **Error Validation**: Proper error handling and recovery

## Scoring Mechanisms

### Primary Score Calculation

The main scoring algorithm evaluates multiple factors:

```javascript
// Simplified scoring logic
score = (
  (goalAchieved ? 50 : 0) +                    // Base achievement score
  (validationCriteriaPercent * 0.3) +          // Criteria coverage
  (conversationQualityScore * 0.2)             // Interaction quality
) * difficultyMultiplier
```

### Score Components

#### 1. Goal Achievement (50% weight)
- **Binary Assessment**: Did the primary goal get accomplished?
- **Source**: AI analysis of conversation and data changes
- **Values**: 0 (failed) or 50 (achieved)

#### 2. Validation Criteria Coverage (30% weight)
- **Percentage Calculation**: How many defined criteria were met?
- **Formula**: `(met_criteria / total_criteria) * 30`
- **Source**: AI analysis comparing expected vs actual outcomes

#### 3. Conversation Quality (20% weight)
- **Interaction Assessment**: Was the conversation helpful and productive?
- **Factors**:
  - Response relevance and accuracy
  - Helpfulness and guidance quality
  - Error handling and recovery
  - User experience quality
- **Scale**: 0-20 points based on interaction analysis

## AI Analysis Prompts for Validation

### Success Analysis Prompt Structure

The success analysis prompt evaluates conversations using this framework:

```text
INPUT COMPONENTS:
- Goal definition and description
- Complete conversation history
- Before/after Salesforce data snapshots
- Defined validation criteria

ANALYSIS REQUIREMENTS:
1. Goal achievement determination (boolean)
2. Validation criteria percentage (0-100)
3. Completed actions list
4. Salesforce changes identification
5. Issues and failures list
6. Summary explanation

OUTPUT FORMAT:
{
  "goalAchieved": boolean,
  "score": number (0-100),
  "completedActions": [string],
  "salesforceChanges": [string],
  "issues": [string],
  "summary": "explanation"
}
```

### Continuation Evaluation Criteria

The continuation prompt uses specific criteria to determine conversation flow:

**STOP CONDITIONS:**
1. Goal successfully achieved
2. AI provided unhelpful/incorrect responses
3. AI appears confused or unable to help
4. Conversation is stuck in loops
5. AI made errors or gave bad advice
6. Poor user experience detected

**CONTINUE CONDITIONS:**
1. Progress being made toward goal
2. AI being helpful and responsive
3. More steps needed for completion
4. Positive, productive interaction

### Quality Assessment Framework

**Positive Indicators (+points):**
- Clear, relevant responses
- Appropriate action suggestions
- Proper information gathering
- Helpful guidance and direction
- Error acknowledgment and correction

**Negative Indicators (-points):**
- Confusing or irrelevant responses
- Incorrect information provided
- Failure to understand user needs
- Repetitive or circular conversations
- Poor error handling

## Data Change Validation

### Salesforce Data Comparison

The system captures and compares Salesforce state before and after interactions:

```javascript
// Example data comparison
salesforceDataBefore: {
  cases: [],
  contacts: [existing_contacts],
  accounts: [existing_accounts]
}

salesforceDataAfter: {
  cases: [new_case_record],
  contacts: [updated_contacts],
  accounts: [modified_accounts]
}
```

### Change Detection Logic

1. **Record Creation**: New records added to Salesforce
2. **Record Updates**: Modified fields in existing records
3. **Relationship Changes**: Updated associations between records
4. **Status Transitions**: Workflow state changes

## Scoring Examples

### Example 1: Successful Case Creation

**Goal**: Create a support case for a customer issue
**Validation Criteria**: 
- Case record created
- Case assigned to support queue
- Customer contacted
- Priority set correctly

**Analysis Results**:
```json
{
  "goalAchieved": true,
  "score": 85,
  "completedActions": [
    "Created case record #12345",
    "Assigned to Technical Support queue",
    "Set priority to High",
    "Sent confirmation email to customer"
  ],
  "salesforceChanges": [
    "New Case record created with ID 12345",
    "Case status set to 'Open'",
    "Assignment rule triggered"
  ],
  "issues": [],
  "summary": "Goal fully achieved with all validation criteria met"
}
```

**Score Breakdown**:
- Goal Achievement: 50 points
- Validation Criteria: 30 points (100% met)
- Conversation Quality: 18 points (excellent interaction)
- **Total**: 98 points

### Example 2: Partial Success

**Goal**: Update customer contact information
**Validation Criteria**:
- Contact record updated
- Change logged in history
- Customer notified of changes

**Analysis Results**:
```json
{
  "goalAchieved": true,
  "score": 65,
  "completedActions": [
    "Updated contact email address",
    "Updated contact phone number"
  ],
  "salesforceChanges": [
    "Contact record modified",
    "Field history updated"
  ],
  "issues": [
    "Customer notification not sent",
    "Change approval process bypassed"
  ],
  "summary": "Primary goal achieved but some validation criteria missed"
}
```

**Score Breakdown**:
- Goal Achievement: 50 points
- Validation Criteria: 20 points (67% met)
- Conversation Quality: 15 points (good but with gaps)
- **Total**: 85 points

### Example 3: Failed Interaction

**Goal**: Schedule a customer meeting
**Validation Criteria**:
- Meeting record created
- Calendar invite sent
- Meeting room booked

**Analysis Results**:
```json
{
  "goalAchieved": false,
  "score": 25,
  "completedActions": [
    "Gathered meeting requirements",
    "Checked availability"
  ],
  "salesforceChanges": [],
  "issues": [
    "Unable to access calendar system",
    "Meeting room booking failed",
    "No meeting record created"
  ],
  "summary": "Goal not achieved due to system integration issues"
}
```

**Score Breakdown**:
- Goal Achievement: 0 points
- Validation Criteria: 0 points (0% met)
- Conversation Quality: 12 points (helpful attempt)
- **Total**: 12 points

## Error Handling in Validation

### AI Analysis Errors

When AI analysis fails, the system provides fallback mechanisms:

```javascript
// Fallback scoring when AI analysis fails
fallbackScore = {
  goalAchieved: false,
  score: 0,
  completedActions: [],
  salesforceChanges: [],
  issues: ["AI analysis failed - manual review required"],
  summary: "Error in automated analysis"
}
```

### Data Comparison Errors

If Salesforce data comparison fails:

1. Use conversation analysis only
2. Reduce confidence score
3. Flag for manual review
4. Log detailed error information

## Continuous Improvement

### Learning from Results

The validation system can be improved by:

1. **Pattern Analysis**: Identifying common failure modes
2. **Criteria Refinement**: Updating validation criteria based on results
3. **Prompt Optimization**: Improving AI analysis accuracy
4. **Threshold Adjustment**: Tuning scoring thresholds

### Quality Metrics

Track validation system performance:

- **Analysis Accuracy**: How often AI assessments match manual review
- **Score Consistency**: Variation in scores for similar interactions
- **False Positives/Negatives**: Incorrect goal achievement assessments
- **Criteria Coverage**: How well validation criteria predict success

## Best Practices

### Defining Effective Validation Criteria

1. **Specific**: Clearly measurable outcomes
2. **Achievable**: Realistic within the conversation scope
3. **Relevant**: Directly related to the goal
4. **Verifiable**: Can be confirmed through data or conversation analysis

### Scoring Interpretation

- **90-100**: Excellent - Goal fully achieved with high quality
- **70-89**: Good - Goal achieved with minor issues
- **50-69**: Adequate - Goal achieved but with significant gaps
- **30-49**: Poor - Goal partially achieved
- **0-29**: Failed - Goal not achieved

### Validation Review Process

1. **Automated Analysis**: AI-powered initial assessment
2. **Data Verification**: Compare actual vs expected data changes
3. **Quality Review**: Evaluate conversation quality and user experience
4. **Manual Override**: Human review for edge cases or disputes
5. **Documentation**: Record results and lessons learned

This comprehensive validation and scoring system ensures objective, measurable assessment of AI agent interactions while providing detailed feedback for continuous improvement.