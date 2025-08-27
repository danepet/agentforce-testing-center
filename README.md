# Agentforce Testing Center

A comprehensive project-based AI Agent testing platform for Salesforce Agentforce. This application allows you to create testing projects, import real customer conversations, generate test goals with AI, run automated human-like conversations with Agentforce, and validate outcomes with detailed analytics and reporting.

## Features

### 🏗️ **Project-Based Organization**
- **Multi-Project Management**: Organize testing goals by project with individual MIAW configurations
- **Project-Specific Settings**: Custom MIAW deployments, goal generation prompts, and testing parameters
- **Isolated Testing**: Keep different testing scenarios separate and organized

### 📊 **CSV Conversation Import & Analysis**
- **Real Conversation Import**: Upload CSV files containing actual customer conversations
- **AI-Powered Analysis**: GPT-4 analyzes conversations for complexity, intent, and emotional tone
- **Automatic Goal Generation**: Convert real customer scenarios into structured test goals
- **Flexible CSV Formats**: Support for various CSV structures with intelligent parsing

### 🤖 **Human-Like Testing Agent**
- **Natural Conversation Style**: Testing agent speaks like a real customer, not an AI
- **Realistic Data Generation**: Uses actual data from conversations or generates believable customer information
- **Adaptive Responses**: Dynamic conversation flow based on Agentforce responses
- **End Reason Tracking**: Captures why conversations end (goal achieved, failed, timeout, etc.)

### 💬 **Advanced MIAW Integration**
- **Session Tracking**: Captures and stores MIAW session IDs for full traceability
- **Persistent Connections**: Maintains real-time SSE connections throughout conversations
- **Project-Specific Configuration**: Different MIAW deployments per project
- **Unauthenticated Token Management**: Simplified setup without Salesforce user credentials

### 📈 **Comprehensive Analytics & Export**
- **Detailed CSV Export**: Export test results with conversation logs, scores, and source data
- **Batch Testing**: Run multiple goals simultaneously with progress tracking
- **Quality Scoring**: AI-powered goal quality assessment and recommendations
- **Full Traceability**: Track from original conversation through testing to results

### 🎨 **Modern Web Dashboard**
- **Project Navigation**: Intuitive project-based interface with tabbed navigation
- **Real-Time Progress**: Live updates during CSV processing and test execution
- **Import/Export Workflows**: Streamlined CSV import with format validation and samples
- **Test Session Management**: Comprehensive test history and detailed result views

## Quick Start

1. **Clone and Install**
   ```bash
   git clone <repository-url>
   cd agentforce-testing-center
   npm install
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your credentials:
   - OpenAI API key
   - Salesforce username, password, and security token
   - Salesforce Messaging deployment configuration

3. **Initialize Database**
   ```bash
   npm run init-db
   ```

4. **Start Application**
   ```bash
   npm run dev
   ```

5. **Access Dashboard**
   Open http://localhost:3000 in your browser

## Configuration

### Required Environment Variables

```env
# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key_here

# Messaging for In-App and Web API Configuration (Unauthenticated)
SALESFORCE_MESSAGING_DEPLOYMENT_NAME=your_miaw_deployment_name
SALESFORCE_MESSAGING_ORG_ID=your_salesforce_org_id
SALESFORCE_MIAW_BASE_URL=https://your_org_domain.develop.my.salesforce.com
```

### Salesforce Setup

1. **Enable Messaging for In-App and Web (MIAW)**
   - Follow the [Salesforce setup guide](https://help.salesforce.com/s/articleView?id=service.miaw_setup_stages.htm)
   - Create a custom client deployment for unauthenticated users
   - Note the deployment name and org ID for configuration
   - Get your org's My Domain URL (e.g., https://yourcompany.develop.my.salesforce.com)

2. **Configure Agentforce**
   - Set up your Agentforce agents in Salesforce
   - Connect agents to your MIAW deployment
   - Test basic messaging functionality

**Key Benefits of MIAW Unauthenticated Approach:**
- ✅ **No Salesforce User Credentials Required** - Uses unauthenticated tokens
- ✅ **Simplified Setup** - Only requires MIAW deployment configuration  
- ✅ **Better for Testing** - Isolated from production authentication systems
- ✅ **Direct Agent Access** - Communicates directly with Agentforce via messaging API

## Complete Testing Workflow

### 1. Project Setup

1. **Create a New Project**
   - Click "Create New Project" on the main dashboard
   - Configure project name, description, and MIAW settings
   - Set up custom goal generation prompts (optional)

2. **Configure MIAW Connection**
   ```
   Deployment Name: your_miaw_deployment_name
   Org ID: your_salesforce_org_id  
   Base URL: https://your_org_domain.develop.my.salesforce.com
   ```

### 2. Import Real Customer Conversations

1. **Prepare CSV File**
   Your CSV must contain at least these columns:
   ```
   conversation_id,conversation_data
   CONV_001,"Customer: Hi I need help with my order..."
   CONV_002,"Customer: I'm having trouble logging in..."
   ```

2. **Import and Analysis Process**
   - Navigate to the project's **Import** tab
   - Upload your CSV file (up to 50MB)
   - AI analyzes each conversation for:
     - Intent and complexity
     - Emotional tone and urgency  
     - Conversation patterns
     - Resolution outcomes

3. **Review Generated Goals**
   - AI converts conversations into structured test goals
   - Each goal includes:
     - Customer-focused test steps using actual conversation language
     - Specific validation criteria based on real scenarios
     - Quality scores and improvement recommendations

4. **Import Selected Goals**
   - Review and select high-quality goals
   - Import chosen goals directly into your project
   - Goals retain connection to original conversation data

### 3. Manual Goal Creation (Alternative)

For custom scenarios not based on real conversations:

1. Navigate to the project's **Goals** tab
2. Click **"Create New Goal"**
3. Fill in the goal details:
   - **Name**: Descriptive goal name
   - **Description**: What the goal aims to achieve
   - **Steps**: Customer actions and requests (not AI actions)
   - **Validation Criteria**: Specific outcomes to verify

Example Goal:
```
Name: PRP Hair Treatment Inquiry
Description: Test ability to provide accurate pricing and consultation booking for PRP treatment
Steps: 
- Ask about PRP treatment for hair restoration, mentioning cost concerns
- Express anxiety about hair loss and ask about pain/side effects  
- Request information about payment plans or financing options
- Ask to schedule a consultation if treatment seems suitable
Validation Criteria:
- Customer receives accurate PRP pricing ($800-1200 range)
- Customer is offered free consultation with specialist
- Empathetic responses address hair loss concerns appropriately
- Payment/financing options are clearly explained
```

### 4. Execute Tests

1. **Single Goal Testing**
   - From the Goals tab, click **"Run Test"** on any goal
   - Watch real-time conversation between testing agent and Agentforce
   - Testing agent behaves like a natural customer, not an AI

2. **Batch Testing** 
   - Select multiple goals for simultaneous testing
   - Configure concurrency settings (default: 3 concurrent tests)
   - Monitor progress with real-time updates
   - Tests run independently with full conversation logs

3. **Testing Process**
   - **MIAW Session Creation**: Establishes connection with Agentforce
   - **Natural Conversation**: Testing agent uses realistic customer language and data
   - **Adaptive Responses**: Agent responds dynamically based on Agentforce replies  
   - **Outcome Detection**: Automatically identifies goal achievement, failure, or timeout
   - **Session Tracking**: Captures MIAW session IDs for full traceability

4. **Human-Like Testing Agent Features**
   - Uses casual, natural language (not formal AI responses)
   - Generates or extracts realistic customer data (names, emails, phone numbers)
   - Maintains conversation context and customer persona
   - Responds appropriately to unexpected Agentforce responses

### 5. Analyze Results & Export

1. **Individual Test Review**
   - Go to the **Test Sessions** tab
   - Click **"View Details"** on any completed test
   - Review comprehensive results:
     - Full conversation transcript with timestamps
     - AI-powered validation scoring and analysis
     - End reason (goal achieved, failed, timeout, etc.)
     - MIAW session ID for Salesforce correlation
     - Original conversation data (if imported from CSV)

2. **Batch Test Analysis**
   - View batch run summaries with success rates
   - Compare performance across different goal types
   - Identify common failure patterns or areas for improvement

3. **CSV Export for Reporting**
   Export comprehensive test results including:
   ```
   - Batch Run Name, Project Name, Goal Details
   - Test Status, Score, Goal Achievement
   - Full Conversation Logs and Validation Summaries  
   - MIAW Session IDs and Original Conversation Data
   - Test Duration and End Reasons
   - Issues Found and Completed Actions
   ```

4. **Quality Insights**
   - Goal quality scores help identify well-performing scenarios
   - Conversation analysis reveals agent strengths and weaknesses
   - Success patterns inform future goal development

## API Documentation

### Projects API

- `POST /api/projects` - Create a new project
- `GET /api/projects` - List all projects  
- `GET /api/projects/:id` - Get specific project
- `PUT /api/projects/:id` - Update project
- `DELETE /api/projects/:id` - Delete project
- `GET /api/projects/:id/export-csv` - Export project test results to CSV

### Goals API

- `POST /api/goals` - Create a new goal
- `GET /api/goals` - List all goals (supports ?projectId filter)
- `GET /api/goals/:id` - Get specific goal
- `PUT /api/goals/:id` - Update goal
- `DELETE /api/goals/:id` - Delete goal

### Tests API

- `POST /api/tests/start` - Start a new test session
- `POST /api/tests/:id/run` - Execute a test
- `GET /api/tests` - List all test sessions
- `GET /api/tests/:id` - Get specific test session
- `DELETE /api/tests/:id` - Delete test session

### Batch Testing API

- `POST /api/batch/start` - Start batch test execution
- `GET /api/batch/:id/progress` - Get batch test progress
- `GET /api/batch/:id/results` - Get batch test results
- `POST /api/batch/:id/stop` - Stop running batch test

### Conversation Import API

- `POST /api/conversations/import` - Import CSV file for analysis
- `GET /api/conversations/import/:jobId/status` - Get import job status
- `GET /api/conversations/import/:jobId/results` - Get analysis results
- `POST /api/conversations/jobs/:jobId/import` - Import selected goals to project
- `GET /api/conversations/jobs/:jobId/analytics` - Get conversation analytics

### Agent API

- `POST /api/agent/test-connection` - Test Salesforce connection
- `POST /api/agent/test-openai` - Test OpenAI connection
- `POST /api/agent/send-message` - Send test message to Agentforce

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Web Dashboard │    │  Testing Agent  │    │   Agentforce    │
│  (Project-Based) │    │ (Human-like AI) │    │  (Salesforce)   │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          │ HTTP API              │ Natural Conversation │ MIAW API
          │                      │                      │
┌─────────▼──────────────────────▼──────────────────────▼───────┐
│                    Node.js Backend                            │
├────────────────────────────────────────────────────────────────┤
│  • Express.js API Server with SSE Support                     │
│  • SQLite Database (Projects, Goals, Test Sessions, Batches)  │
│  • OpenAI GPT-4 Integration (Analysis & Testing)              │
│  • Messaging for In-App and Web API (Unauthenticated)         │
│  • CSV Processing & Conversation Analysis Engine              │
│  • Batch Test Executor with Concurrent Processing             │
│  • Real-time Progress Tracking & Session Management           │
└────────────────────────────────────────────────────────────────┘
```

## Technology Stack

- **Backend**: Node.js, Express.js with Server-Sent Events (SSE)
- **Database**: SQLite with schema migrations
- **AI & Analysis**: OpenAI GPT-4 API for conversation analysis and testing
- **Salesforce Integration**: Messaging for In-App and Web (MIAW) API with unauthenticated tokens
- **CSV Processing**: Professional csv-parse library with streaming support
- **Frontend**: HTML5, CSS3, Vanilla JavaScript with real-time updates
- **File Management**: Multer for CSV uploads with validation
- **Concurrency**: Multi-worker batch processing with EventEmitter coordination

## Development

### Project Structure
```
src/
├── server.js                    # Express server with SSE support
├── database/
│   └── init.js                 # Database initialization with migrations
├── models/
│   ├── Project.js              # Project data model with MIAW config
│   ├── Goal.js                 # Goal model with source conversation tracking
│   ├── TestSession.js          # Test session model with MIAW session IDs
│   └── BatchTestRun.js         # Batch execution tracking model
├── routes/
│   ├── projects.js             # Project management and CSV export
│   ├── goals.js                # Goals API with project filtering  
│   ├── tests.js                # Individual test execution
│   ├── batch.js                # Batch test execution and monitoring
│   ├── conversations.js        # CSV import and conversation analysis
│   └── agent.js                # Connection testing utilities
└── services/
    ├── TestingAgent.js         # Human-like conversation AI
    ├── SalesforceClient.js     # MIAW API client with SSE
    ├── ConversationAnalyzer.js # GPT-4 conversation analysis
    ├── CSVProcessor.js         # Robust CSV parsing and processing
    └── BatchTestExecutor.js    # Concurrent test execution manager

public/
├── index.html                  # Project-based dashboard with tabs
├── styles.css                  # Modern responsive styles
└── script.js                   # Dynamic frontend with real-time updates
```

### Testing the Application

1. **Verify Connections**
   - Create a test project with your MIAW configuration
   - Use the Connections tab to test OpenAI and Agentforce connectivity
   - Send test messages to ensure MIAW communication works

2. **Test with Sample Data**
   - Start with simple manually created goals like "Get help information"
   - Try importing a small CSV file with 2-3 sample conversations
   - Run individual tests before attempting batch execution

3. **Monitor Progress**
   - Check server console for detailed operation logs
   - Watch real-time progress updates in the web interface
   - Use browser dev tools for frontend debugging
   - Review CSV export results to verify data flow

4. **Development Workflow**
   - Use `npm run dev` to start the development server with auto-reload
   - Database changes are automatically migrated on startup
   - Upload directory and logs are created automatically
   - All API endpoints support detailed error reporting

## Troubleshooting

### Common Issues

1. **MIAW Connection Problems**
   - Confirm Messaging for In-App and Web is enabled in Salesforce  
   - Verify deployment name and org ID are correct
   - Check that your org's My Domain URL is properly formatted
   - Ensure the deployment allows unauthenticated users
   - Test MIAW directly in Salesforce before using the testing platform

2. **OpenAI API Issues**
   - Verify API key is correct and has sufficient credits
   - Check for rate limiting (GPT-4 has lower limits than GPT-3.5)
   - Ensure your OpenAI account has access to GPT-4 models
   - Monitor token usage during CSV processing

3. **CSV Import Failures**
   - Ensure CSV contains required columns: `conversation_id` and `conversation_data`
   - Check file size (50MB limit) and character encoding (UTF-8)
   - Verify conversations contain substantive customer service content
   - Monitor job status endpoint for detailed error messages
   - Clear browser cache if import progress appears stuck

4. **Test Execution Problems**
   - Review full conversation logs in test session details
   - Check if Agentforce agent is properly configured and active
   - Verify project MIAW settings match your Salesforce org configuration
   - Monitor server console for detailed error messages
   - Ensure testing agent goals have realistic, achievable objectives

5. **Performance Issues**
   - Reduce batch concurrency for large test runs (default: 3)
   - Monitor OpenAI API rate limits during intensive testing
   - Check database file size if using SQLite for large datasets
   - Clear old job data periodically using cleanup endpoint

6. **Data Export Problems**
   - Verify test sessions completed successfully before export
   - Check that source conversation data was properly stored during import
   - Ensure MIAW session IDs were captured during test execution
   - Review CSV export endpoint logs for processing errors

## Recent Enhancements

✅ **Project-Based Organization**: Complete project management with MIAW configuration  
✅ **CSV Import & Analysis**: Upload real conversations and generate test goals with AI  
✅ **Human-Like Testing Agent**: Natural conversation style with realistic data  
✅ **Batch Testing**: Concurrent test execution with progress monitoring  
✅ **MIAW Session Tracking**: Full session traceability and conversation storage  
✅ **Comprehensive CSV Export**: Complete test results with source conversation data  
✅ **Quality Scoring**: AI-powered goal assessment and improvement recommendations  
✅ **Real-Time Updates**: Live progress tracking during imports and test execution

## Roadmap

- [ ] **Advanced Analytics Dashboard**: Trend analysis and performance metrics across projects
- [ ] **Scheduled Testing**: Automated recurring test execution with notifications  
- [ ] **A/B Testing Framework**: Compare different Agentforce configurations
- [ ] **LWC Migration**: Native Salesforce Lightning components for embedded testing
- [ ] **Multi-Agent Testing**: Support for testing agent-to-agent interactions
- [ ] **CI/CD Integration**: GitHub Actions for automated testing pipelines
- [ ] **Advanced Validation Rules**: Visual rule builder for complex outcome validation
- [ ] **Performance Benchmarking**: Response time and throughput analysis

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details