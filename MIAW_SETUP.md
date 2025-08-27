# MIAW (Messaging for In-App and Web) Setup Guide

This guide helps you configure Salesforce Messaging for In-App and Web API for unauthenticated access with the Agentforce Testing Center.

## Prerequisites

- Salesforce org with Agentforce enabled
- Administrator access to Salesforce
- My Domain configured in your org

## Step 1: Enable Messaging for In-App and Web

1. **Navigate to Setup**
   - Go to Setup in your Salesforce org
   - Search for "Messaging for In-App and Web" in Quick Find

2. **Enable MIAW**
   - Click "Get Started" on the Messaging for In-App and Web page
   - Follow the setup wizard to enable the feature

## Step 2: Create a Custom Client Deployment

1. **Go to Deployments**
   - In Setup, navigate to Messaging for In-App and Web > Deployments
   - Click "New Deployment"

2. **Configure Deployment**
   - **Name**: Choose a descriptive name (e.g., "Testing Center Deployment")
   - **Developer Name**: This will be your `SALESFORCE_MESSAGING_DEPLOYMENT_NAME`
   - **Type**: Select "Custom Client"
   - **Authentication**: Choose "Unauthenticated Users" (this is key!)

3. **Configure Settings**
   - **Branding**: Set up your branding preferences
   - **Availability**: Configure business hours if needed
   - **Pre-Chat**: Configure any pre-chat requirements
   - **Agent Assignment**: Set up routing to your Agentforce agents

4. **Save and Publish**
   - Save the deployment
   - Click "Publish" to make it active

## Step 3: Get Configuration Values

After creating your deployment, gather these values for your `.env` file:

### Deployment Name
- This is the Developer Name from your deployment
- Example: `testing_center_deployment`

### Organization ID
- Go to Setup > Company Information
- Find your Salesforce ID (starts with `00D`)
- Example: `00D000000000000`

### Base URL
- Use your org's My Domain URL
- Format: `https://yourcompany.develop.my.salesforce.com`
- Replace `yourcompany` with your actual domain

## Step 4: Configure Environment Variables

Update your `.env` file with:

```env
# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key_here

# MIAW Configuration
SALESFORCE_MESSAGING_DEPLOYMENT_NAME=your_deployment_developer_name
SALESFORCE_MESSAGING_ORG_ID=00D000000000000
SALESFORCE_MIAW_BASE_URL=https://yourcompany.develop.my.salesforce.com

# Server Configuration  
PORT=3000
NODE_ENV=development

# Database Configuration
DB_PATH=./data/testing_center.db
```

## Step 5: Test Your Configuration

1. **Start the Application**
   ```bash
   npm run dev
   ```

2. **Test MIAW Connection**
   - Open http://localhost:3000
   - Go to the "Connections" tab
   - Click "Test MIAW Token"
   - You should see a success message

3. **Test Message Flow**
   - Use the "Send Test Message" functionality
   - Verify messages reach your Agentforce agents

## Step 6: Configure Agentforce Integration

1. **Connect Agent to MIAW**
   - Go to Setup > Einstein (Apps) > Agentforce
   - Edit your agent configuration
   - In the "Channels" section, add your MIAW deployment

2. **Test Agent Response**
   - Send a test message through the Testing Center
   - Verify your Agentforce agent responds appropriately

## Troubleshooting

### Common Issues

**Token Generation Fails**
- Verify your org ID is correct (starts with `00D`)
- Check that your deployment developer name is exact
- Ensure the deployment is published and active

**Messages Not Reaching Agent**  
- Verify the agent is connected to your MIAW deployment
- Check business hours and availability settings
- Review agent configuration and routing rules

**Endpoint URL Issues**
- Verify your My Domain URL is correct
- Ensure HTTPS is used
- Check that the domain is accessible

### Debug Steps

1. **Check Deployment Status**
   - Go to Deployments in Setup
   - Verify status is "Active"
   - Check publication date

2. **Review Agent Logs**
   - Monitor Setup > Einstein (Apps) > Agentforce
   - Check conversation logs for errors

3. **Test with Salesforce Tools**
   - Use the built-in testing tools in MIAW setup
   - Verify basic messaging works before testing with external tools

## API Endpoints Used

The Testing Center uses these MIAW endpoints:

- **Token Generation**: `/iamessage/api/v2/authorization/unauthenticated/access-token`
- **Start Conversation**: `{endpointUrl}/conversation`  
- **Send Message**: `{endpointUrl}/conversation/{conversationId}/message`
- **Get Messages**: `{endpointUrl}/conversation/{conversationId}/messages`
- **End Conversation**: `{endpointUrl}/conversation/{conversationId}/end`

All requests use the capabilities version "248" and platform "Web".

## Benefits of This Approach

✅ **No User Authentication** - No need to manage Salesforce user credentials
✅ **Simplified Setup** - Only requires MIAW deployment configuration
✅ **Better Security** - Isolated from production user authentication
✅ **Scalable Testing** - Multiple test sessions without user limits
✅ **Direct Agent Access** - Communicates directly with Agentforce

## Next Steps

Once MIAW is configured:
1. Create your first test goal using the templates
2. Run a test to verify the full conversation flow
3. Review test results and conversation logs
4. Set up additional goals for comprehensive testing

For more information, see the main README.md file.