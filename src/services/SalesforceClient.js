const axios = require('axios');

class SalesforceClient {
  constructor(projectConfig = null) {
    this.accessToken = null;
    this.conversationId = null;
    this.conversationIdentifier = null;
    this.endpointUrl = null;
    this.configuration = null;
    this.hasActiveConversation = false; // Track if conversation is active
    
    // Use project-specific config if provided, otherwise fall back to environment variables
    this.miawConfig = {
      orgId: projectConfig?.miawOrgId || process.env.SALESFORCE_MESSAGING_ORG_ID,
      deploymentName: projectConfig?.miawDeploymentName || process.env.SALESFORCE_MESSAGING_DEPLOYMENT_NAME,
      baseUrl: projectConfig?.miawBaseUrl || process.env.SALESFORCE_MIAW_BASE_URL,
      routingAttributes: projectConfig?.miawRoutingAttributes || null
    };
  }

  // Helper method to decode JWT payload (without verification - for debugging only)
  decodeJWTPayload(token) {
    try {
      const base64Payload = token.split('.')[1];
      const decodedPayload = Buffer.from(base64Payload, 'base64').toString('utf-8');
      return JSON.parse(decodedPayload);
    } catch (error) {
      console.log('Error decoding JWT payload:', error.message);
      return null;
    }
  }

  // Generate a proper UUID v4
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  async generateUnauthenticatedToken() {
    try {
      const tokenRequest = {
        esDeveloperName: this.miawConfig.deploymentName,
        orgId: this.miawConfig.orgId,
        capabilitiesVersion: "1", // Use "1" as accepted by your SCRT endpoint
        platform: "Web" // Only platform field, not platformName
      };

      console.log('Generating unauthenticated token for MIAW...');
      console.log('Using deployment:', this.miawConfig.deploymentName);
      console.log('Using org ID:', this.miawConfig.orgId);
      console.log('Org ID length:', this.miawConfig.orgId?.length);
      console.log('Using base URL:', this.miawConfig.baseUrl);
      console.log('Sending payload:', JSON.stringify(tokenRequest, null, 2));
      
      // Focus on the endpoint that actually exists (from debugging)
      const baseUrl = this.miawConfig.baseUrl;
      const possibleEndpoints = [
        // This endpoint exists but needs proper payload format
        `${baseUrl}/iamessage/api/v2/authorization/unauthenticated/access-token`,
        
        // Backup attempts with different variations
        `${baseUrl}/services/data/v59.0/messaging/conversations/authorization/unauthenticated/access-token`,
        `${baseUrl}/messaging/api/v2/authorization/unauthenticated/access-token`
      ];

      let response = null;
      let lastError = null;

      for (const endpoint of possibleEndpoints) {
        try {
          console.log('Trying endpoint:', endpoint);
          response = await axios.post(endpoint, tokenRequest, {
            headers: {
              'Content-Type': 'application/json'
            },
            timeout: 10000
          });
          console.log('Success with endpoint:', endpoint);
          break;
        } catch (endpointError) {
          console.log('❌ Failed with endpoint:', endpoint);
          console.log('   Status:', endpointError.response?.status);
          console.log('   Status Text:', endpointError.response?.statusText);
          console.log('   Error Message:', endpointError.message);
          if (endpointError.response?.data) {
            console.log('   Response Data Preview:', 
              typeof endpointError.response.data === 'string' 
                ? endpointError.response.data.substring(0, 200) + '...'
                : JSON.stringify(endpointError.response.data).substring(0, 200) + '...'
            );
          }
          lastError = endpointError;
          continue;
        }
      }

      if (!response) {
        console.error('All endpoints failed. Last error:', lastError.response?.data || lastError.message);
        throw new Error(`Failed to connect to MIAW API. Tried multiple endpoints. Last error: ${lastError.message}`);
      }

      console.log('MIAW unauthenticated token generated successfully');
      
      this.accessToken = response.data.accessToken;
      this.configuration = response.data.context?.configuration;
      
      // Extract session information from the response that might contain conversation identifiers
      const tokenPayload = this.decodeJWTPayload(response.data.accessToken);
      console.log('Decoded token payload:', JSON.stringify(tokenPayload, null, 2));
      
      // Try to extract conversation-related IDs from the token
      this.deviceId = tokenPayload?.deviceId || response.data.context?.deviceId;
      this.channelAddressIdentifier = response.data.context?.configuration?.embeddedServiceConfig?.embeddedServiceMessagingChannel?.channelAddressIdentifier;
      this.clientSessionId = tokenPayload?.clientSessionId;
      
      // Construct endpoint URL based on the base URL since the API doesn't return endpointUrl
      // The conversation endpoints use the same base URL with different paths
      this.endpointUrl = this.miawConfig.baseUrl;
      
      console.log('Access Token:', this.accessToken ? 'Present' : 'Missing');
      console.log('Constructed Endpoint URL:', this.endpointUrl);
      console.log('Configuration:', this.configuration ? 'Present' : 'Missing');
      console.log('Device ID:', this.deviceId);
      console.log('Channel Address ID:', this.channelAddressIdentifier);
      console.log('Client Session ID:', this.clientSessionId);
      return response.data;
    } catch (error) {
      console.error('Error generating unauthenticated token:', error.response?.data || error.message);
      throw new Error('Failed to generate unauthenticated token for MIAW: ' + error.message);
    }
  }

  async startConversation() {
    try {
      if (!this.accessToken) {
        await this.generateUnauthenticatedToken();
      }

      // Generate a proper conversation ID instead of using clientSessionId
      // Based on MIAW documentation: "Don't use user IDs or other IDs as the ConversationID"
      this.conversationId = this.generateUUID();
      this.conversationIdentifier = this.conversationId;
      
      console.log('MIAW Conversation creating new conversation');
      console.log('Generated Conversation ID:', this.conversationId);
      
      // Try to create conversation using the proper endpoint with correct API specification
      try {
        // Build routing attributes - merge custom project attributes with required system attributes
        const systemRoutingAttributes = {
          // Required system attributes for MIAW functionality
          deviceId: this.deviceId,
          channelAddressIdentifier: this.channelAddressIdentifier,
          platform: "Web",
          clientSessionId: this.clientSessionId
        };

        // Parse custom routing attributes from project configuration
        let customRoutingAttributes = {};
        if (this.miawConfig.routingAttributes) {
          try {
            customRoutingAttributes = JSON.parse(this.miawConfig.routingAttributes);
          } catch (error) {
            console.warn('Invalid routing attributes JSON in project config:', error);
          }
        }

        // Merge custom attributes with system attributes (system attributes take precedence)
        const routingAttributes = { ...customRoutingAttributes, ...systemRoutingAttributes };

        const conversationData = {
          conversationId: this.conversationId.toLowerCase(), // Must be lowercase per API spec
          esDeveloperName: this.miawConfig.deploymentName,
          language: "en_US", // Required field per API spec
          routingAttributes: routingAttributes
        };

        console.log('Creating conversation with payload:', JSON.stringify(conversationData, null, 2));

        const createResponse = await axios.post(
          `${this.endpointUrl}/iamessage/api/v2/conversation`,
          conversationData,
          {
            headers: {
              'Authorization': `Bearer ${this.accessToken}`,
              'Content-Type': 'application/json'
            },
            timeout: 10000
          }
        );

        console.log('Conversation created successfully:', JSON.stringify(createResponse.data, null, 2));
      } catch (createError) {
        console.log('Conversation creation failed, proceeding without explicit creation:', createError.response?.data || createError.message);
        // Continue anyway - some MIAW implementations may not require explicit conversation creation
      }
      
      console.log('MIAW Conversation started:', this.conversationId);
      
      return {
        conversationId: this.conversationId,
        conversationIdentifier: this.conversationIdentifier
      };
    } catch (error) {
      console.error('Error starting conversation:', error.response?.data || error.message);
      throw new Error('Failed to start conversation with Agentforce via MIAW');
    }
  }

  async sendMessage(message) {
    try {
      if (!this.conversationId) {
        await this.startConversation();
      }

      // Correct MIAW API v2 message structure based on official documentation
      // For first message in session, set isNewMessagingSession: true
      const isFirstMessage = !this.hasActiveConversation;
      const messageData = {
        esDeveloperName: this.miawConfig.deploymentName,
        isNewMessagingSession: isFirstMessage, // True for first message to start conversation
        language: "en",
        routingAttributes: {
          // Add some routing attributes that might be needed for conversation creation
          deviceId: this.deviceId,
          channelAddressIdentifier: this.channelAddressIdentifier
        },
        message: {
          inReplyToMessageId: "", // Empty for new messages
          id: this.generateUUID(), // Proper UUID format
          messageType: "StaticContentMessage", // Correct messageType for text
          staticContent: {
            formatType: "Text",
            text: message
          }
        }
      };
      
      console.log('Sending message with payload:', JSON.stringify(messageData, null, 2));
      console.log('Is first message?', isFirstMessage);

      // Use the standard conversation message endpoint
      const messageEndpoint = `${this.endpointUrl}/iamessage/api/v2/conversation/${this.conversationId}/message`;
      
      console.log('Sending to endpoint:', messageEndpoint);

      try {
        const response = await axios.post(
          messageEndpoint,
          messageData,
          {
            headers: {
              'Authorization': `Bearer ${this.accessToken}`,
              'Content-Type': 'application/json'
            },
            timeout: 10000
          }
        );

        console.log('Message sent successfully via MIAW');
        console.log('Response:', JSON.stringify(response.data, null, 2));
        
        // Mark conversation as active after first successful message
        if (isFirstMessage) {
          this.hasActiveConversation = true;
          console.log('Conversation is now active');
        }
        
        return response.data;
      } catch (error) {
        console.error('Error sending message:', error.response?.data || error.message);
        throw new Error('Failed to send message to Agentforce via MIAW');
      }
    } catch (error) {
      console.error('Error sending message:', error.response?.data || error.message);
      throw new Error('Failed to send message to Agentforce via MIAW');
    }
  }

  // Start a persistent SSE session for multi-turn conversation
  async startConversationSession() {
    if (!this.conversationId) {
      throw new Error('No active conversation');
    }

    console.log('Starting persistent SSE session for conversation...');
    
    const session = new MIAWConversationSession(this);
    await session.initialize();
    return session;
  }

  // Legacy method for single message retrieval (kept for compatibility)
  async getMessages() {
    try {
      if (!this.conversationId) {
        throw new Error('No active conversation');
      }

      console.log('Establishing SSE connection to listen for AI Agent responses...');
      
      // Implement retry logic for SSE connections
      const maxRetries = 3;
      let lastError = null;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`SSE connection attempt ${attempt}/${maxRetries}`);
          const messages = await this.establishSSEConnection(attempt);
          if (messages.length > 0) {
            return messages;
          }
          // If no messages but connection was successful, continue to next attempt
          console.log(`Attempt ${attempt}: No AI Agent messages received, retrying...`);
        } catch (error) {
          lastError = error;
          console.log(`Attempt ${attempt} failed: ${error.message}`);
          
          if (attempt < maxRetries) {
            // Exponential backoff: 2s, 4s for retries
            const delay = Math.pow(2, attempt) * 1000;
            console.log(`Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      
      // All attempts failed
      throw lastError || new Error(`Failed to receive AI Agent response after ${maxRetries} attempts`);
      
    } catch (error) {
      console.error('Error in getMessages:', error);
      throw new Error('Failed to get messages from MIAW conversation');
    }
  }

  async establishSSEConnection(attempt = 1) {
    return new Promise((resolve, reject) => {
      const messages = [];
      let connectionTimeout;
      let eventReceived = false;
      let connectionClosed = false;
      let eventBuffer = ''; // Buffer for handling partial events

      // Create SSE connection with proper headers from documentation
      const sseUrl = new URL(`${this.endpointUrl}/eventrouter/v1/sse`);
      sseUrl.searchParams.append('channelPlatformKey', this.channelAddressIdentifier);
      sseUrl.searchParams.append('channelType', 'embedded_messaging');
      sseUrl.searchParams.append('channelAddressIdentifier', this.channelAddressIdentifier);
      sseUrl.searchParams.append('conversationId', this.conversationId.toLowerCase());

      console.log(`[Attempt ${attempt}] SSE URL:`, sseUrl.toString());

      // Use Node.js HTTP for SSE with enhanced connection options
      const https = require('https');
      const http = require('http');
      
      const protocol = sseUrl.protocol === 'https:' ? https : http;
      
      const options = {
        hostname: sseUrl.hostname,
        port: sseUrl.port || (sseUrl.protocol === 'https:' ? 443 : 80),
        path: sseUrl.pathname + sseUrl.search,
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
          'Authorization': `Bearer ${this.accessToken}`,
          'X-Org-Id': this.client.miawConfig.orgId,
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'User-Agent': 'MIAW-SSE-Client/1.0'
        },
        // Enhanced connection options for stability
        keepAlive: true,
        keepAliveMsecs: 30000,
        timeout: 30000
      };

      const closeConnection = (reason) => {
        if (connectionClosed) return;
        connectionClosed = true;
        
        console.log(`[Attempt ${attempt}] Closing SSE connection: ${reason}`);
        if (connectionTimeout) clearTimeout(connectionTimeout);
        if (req) req.destroy();
      };

      const req = protocol.request(options, (res) => {
        console.log(`[Attempt ${attempt}] SSE connection established, status:`, res.statusCode);
        
        if (res.statusCode !== 200) {
          console.error(`[Attempt ${attempt}] SSE connection failed with status:`, res.statusCode);
          closeConnection('Non-200 status');
          reject(new Error(`SSE connection failed: ${res.statusCode} ${res.statusMessage}`));
          return;
        }

        res.setEncoding('utf8');
        
        res.on('data', (chunk) => {
          if (connectionClosed) return;
          
          eventBuffer += chunk;
          console.log(`[Attempt ${attempt}] SSE data received:`, chunk);
          eventReceived = true;
          
          // Check if this chunk contains JSON data (AI Agent response)
          const trimmedChunk = chunk.trim();
          if (trimmedChunk.startsWith('{') && trimmedChunk.endsWith('}')) {
            try {
              const responseData = JSON.parse(trimmedChunk);
              console.log(`[Attempt ${attempt}] Direct JSON response detected - processing AI Agent message`);
              
              // Process direct JSON response (this is the AI Agent response format)
              this.processMIAWResponse(responseData, messages, attempt);
              
              // Check if we got an AI Agent response
              const aiResponse = messages.find(msg => 
                msg.source === 'Chatbot' || msg.source === 'Agent' || 
                msg.senderDisplayName?.includes('Agent')
              );
              
              if (aiResponse) {
                console.log(`[Attempt ${attempt}] AI Agent response received, closing connection`);
                closeConnection('AI Agent response received');
                resolve(messages);
                return;
              }
            } catch (e) {
              // Not valid JSON, continue with normal SSE processing
              console.log(`[Attempt ${attempt}] Not valid JSON, processing as SSE event`);
            }
          }
          
          // Process standard SSE events from buffer
          const events = this.parseSSEEventsFromBuffer(eventBuffer);
          
          for (const event of events.complete) {
            this.processSSEEvent(event, messages, attempt, () => {
              // AI Agent response received - close connection
              closeConnection('AI Agent response received');
              resolve(messages);
            });
          }
          
          // Keep remaining partial event in buffer
          eventBuffer = events.remaining;
        });

        res.on('end', () => {
          if (connectionClosed) return;
          
          console.log(`[Attempt ${attempt}] SSE connection ended`);
          closeConnection('Connection ended');
          
          if (messages.length > 0) {
            resolve(messages);
          } else if (!eventReceived) {
            reject(new Error('SSE connection ended without receiving any events'));
          } else {
            resolve([]); // No messages but connection was successful
          }
        });

        res.on('error', (error) => {
          if (connectionClosed) return;
          
          console.error(`[Attempt ${attempt}] SSE stream error:`, error);
          closeConnection('Stream error');
          reject(error);
        });
      });

      req.on('error', (error) => {
        if (connectionClosed) return;
        
        console.error(`[Attempt ${attempt}] SSE request error:`, error);
        closeConnection('Request error');
        reject(error);
      });

      req.on('timeout', () => {
        if (connectionClosed) return;
        
        console.error(`[Attempt ${attempt}] SSE request timeout`);
        closeConnection('Request timeout');
        reject(new Error('SSE request timeout'));
      });

      // Set timeout for waiting for AI Agent response (longer timeout)
      connectionTimeout = setTimeout(() => {
        if (connectionClosed) return;
        
        console.log(`[Attempt ${attempt}] SSE connection timeout - no AI Agent response received`);
        closeConnection('Response timeout');
        
        if (messages.length > 0) {
          resolve(messages);
        } else {
          reject(new Error('Timeout waiting for AI Agent response via SSE'));
        }
      }, 40000); // 40 second timeout (longer to account for routing delays)

      req.end();
    });
  }

  // Parse SSE events from buffer, handling partial events
  parseSSEEventsFromBuffer(buffer) {
    const complete = [];
    const lines = buffer.split('\n');
    let currentEvent = {};
    let i = 0;
    
    while (i < lines.length) {
      const line = lines[i];
      
      if (line.startsWith('event: ')) {
        currentEvent.type = line.substring(7).trim();
      } else if (line.startsWith('data: ')) {
        const dataContent = line.substring(6);
        try {
          currentEvent.data = JSON.parse(dataContent);
        } catch (e) {
          currentEvent.data = dataContent;
        }
      } else if (line.startsWith('id: ')) {
        currentEvent.id = line.substring(4).trim();
      } else if (line === '' && (currentEvent.type || currentEvent.data)) {
        // End of event - add to complete events
        complete.push(currentEvent);
        currentEvent = {};
      }
      
      i++;
    }
    
    // Calculate remaining buffer (incomplete event)
    let remaining = '';
    if (Object.keys(currentEvent).length > 0) {
      // Reconstruct incomplete event
      if (currentEvent.id) remaining += `id: ${currentEvent.id}\n`;
      if (currentEvent.type) remaining += `event: ${currentEvent.type}\n`;
      if (currentEvent.data) {
        const dataStr = typeof currentEvent.data === 'string' ? currentEvent.data : JSON.stringify(currentEvent.data);
        remaining += `data: ${dataStr}\n`;
      }
    }
    
    return { complete, remaining };
  }

  // Process direct MIAW JSON response (without SSE event wrapper)
  processMIAWResponse(responseData, messages, attempt) {
    if (!responseData.conversationEntry) {
      console.log(`[Attempt ${attempt}] No conversationEntry in response`);
      return;
    }
    
    const senderRole = responseData.conversationEntry.sender?.role;
    const senderDisplayName = responseData.conversationEntry.senderDisplayName;
    const entryType = responseData.conversationEntry.entryType;
    
    console.log(`[Attempt ${attempt}] MIAW Response - Sender: ${senderDisplayName}, Role: ${senderRole}, Type: ${entryType}`);
    
    // Check if this is a message from AI Agent
    if (entryType === 'Message' && senderRole && senderRole !== 'EndUser') {
      // Parse the entryPayload to extract the actual message text
      let messageText = '';
      try {
        const payload = JSON.parse(responseData.conversationEntry.entryPayload);
        messageText = payload.abstractMessage?.staticContent?.text || 'No text content';
        
        console.log(`[Attempt ${attempt}] AI Agent message text: "${messageText}"`);
        
        messages.push({
          id: responseData.conversationEntry.identifier,
          source: senderRole,
          senderDisplayName: senderDisplayName,
          message: {
            text: messageText
          },
          timestamp: new Date(responseData.conversationEntry.transcriptedTimestamp).toISOString()
        });
        
        console.log(`[Attempt ${attempt}] Successfully parsed AI Agent response!`);
        
      } catch (e) {
        console.error(`[Attempt ${attempt}] Error parsing entryPayload:`, e);
        messageText = responseData.conversationEntry.entryPayload || 'No text content';
        
        messages.push({
          id: responseData.conversationEntry.identifier,
          source: senderRole,
          senderDisplayName: senderDisplayName,
          message: {
            text: messageText
          },
          timestamp: new Date(responseData.conversationEntry.transcriptedTimestamp).toISOString()
        });
      }
    } else {
      console.log(`[Attempt ${attempt}] Non-message entry type: ${entryType}`);
    }
  }

  // Process individual SSE event
  processSSEEvent(event, messages, attempt, onAIResponse) {
    // Handle ping/keepalive events
    if (event.type === 'ping' || !event.type) {
      console.log(`[Attempt ${attempt}] Received keepalive ping`);
      return;
    }
    
    console.log(`[Attempt ${attempt}] Processing SSE event:`, event.type);
    
    if (event.type === 'CONVERSATION_MESSAGE' && event.data) {
      const senderRole = event.data.conversationEntry?.sender?.role;
      const senderDisplayName = event.data.conversationEntry?.senderDisplayName;
      
      // Only process non-EndUser messages (AI Agent responses)
      if (senderRole && senderRole !== 'EndUser') {
        console.log(`[Attempt ${attempt}] AI Agent message received:`, {
          sender: senderDisplayName,
          role: senderRole,
          type: event.type
        });
        
        // Parse the entryPayload to extract the actual message text
        let messageText = '';
        try {
          const payload = JSON.parse(event.data.conversationEntry?.entryPayload);
          messageText = payload.abstractMessage?.staticContent?.text || 'No text content';
        } catch (e) {
          messageText = event.data.conversationEntry?.entryPayload || 'No text content';
        }
        
        messages.push({
          id: event.data.conversationEntry?.identifier,
          source: senderRole,
          senderDisplayName: senderDisplayName,
          message: {
            text: messageText
          },
          timestamp: new Date(event.data.conversationEntry?.transcriptedTimestamp).toISOString()
        });
        
        // Close connection after receiving AI Agent response
        if (senderRole === 'Chatbot' || senderRole === 'Agent') {
          console.log(`[Attempt ${attempt}] AI Agent response text: "${messageText}"`);
          onAIResponse();
        }
      }
    } else if (event.type === 'CONVERSATION_PARTICIPANT_CHANGED') {
      console.log(`[Attempt ${attempt}] Participant changed - AI Agent may be joining`);
    } else if (event.type === 'CONVERSATION_TYPING_STARTED_INDICATOR') {
      console.log(`[Attempt ${attempt}] AI Agent is typing...`);
    } else {
      console.log(`[Attempt ${attempt}] Other event type: ${event.type}`);
    }
  }

  // Legacy method - keeping for compatibility
  parseSSEEvents(sseData) {
    const events = [];
    const lines = sseData.split('\n');
    let currentEvent = {};

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent.type = line.substring(7);
      } else if (line.startsWith('data: ')) {
        try {
          currentEvent.data = JSON.parse(line.substring(6));
        } catch (e) {
          currentEvent.data = line.substring(6);
        }
      } else if (line === '' && currentEvent.type) {
        events.push(currentEvent);
        currentEvent = {};
      }
    }

    return events;
  }

  // Helper method to parse SSE event stream data
  parseSSEMessages(sseData) {
    const messages = [];
    try {
      // SSE data format: "data: {json}\n\n"
      const events = sseData.split('\n\n');
      
      for (const event of events) {
        if (event.startsWith('data: ')) {
          const jsonData = event.substring(6); // Remove "data: " prefix
          try {
            const eventData = JSON.parse(jsonData);
            
            // Look for CONVERSATION_MESSAGE events
            if (eventData.eventType === 'CONVERSATION_MESSAGE') {
              messages.push({
                id: eventData.conversationEntry?.id,
                source: eventData.conversationEntry?.senderType,
                message: {
                  text: eventData.conversationEntry?.message?.staticContent?.text
                },
                timestamp: eventData.conversationEntry?.serverTimestamp
              });
            }
          } catch (parseError) {
            console.log('Could not parse SSE event data:', parseError.message);
          }
        }
      }
    } catch (error) {
      console.log('Error parsing SSE data:', error.message);
    }
    
    return messages;
  }

  async endConversation() {
    try {
      if (!this.conversationId) {
        return;
      }

      // First, end the messaging session using the proper endMessagingSession API
      await this.endMessagingSession();

      // Then end the conversation
      await axios.post(
        `${this.endpointUrl}/iamessage/api/v2/conversation/${this.conversationId}/end`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('MIAW Conversation ended:', this.conversationId);
      this.conversationId = null;
      this.conversationIdentifier = null;
    } catch (error) {
      console.error('Error ending conversation:', error.response?.data || error.message);
    }
  }

  async endMessagingSession() {
    try {
      if (!this.conversationId || !this.miawConfig.deploymentName) {
        return;
      }

      console.log(`Ending messaging session for conversation: ${this.conversationId}`);
      
      await axios.delete(
        `${this.endpointUrl}/iamessage/api/v2/conversation/${this.conversationId}/session`,
        {
          params: {
            esDeveloperName: this.miawConfig.deploymentName
          },
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('MIAW Messaging session ended successfully');
    } catch (error) {
      console.error('Error ending messaging session:', error.response?.data || error.message);
      // Don't throw here as we still want to try to end the conversation
    }
  }

  // Mock data capture for testing since we don't have authenticated Salesforce access
  async captureDataSnapshot(objectTypes = ['Case', 'Contact', 'Account', 'Opportunity']) {
    try {
      console.log('Capturing mock data snapshot for testing...');
      
      // Return mock data structure for testing purposes
      const snapshot = {};
      
      for (const objectType of objectTypes) {
        snapshot[objectType] = [
          {
            Id: `mock-${objectType.toLowerCase()}-${Date.now()}`,
            CreatedDate: new Date().toISOString(),
            LastModifiedDate: new Date().toISOString()
          }
        ];
      }

      return snapshot;
    } catch (error) {
      console.error('Error capturing data snapshot:', error);
      throw new Error('Failed to capture Salesforce data snapshot');
    }
  }

  async compareDataSnapshots(beforeSnapshot, afterSnapshot) {
    const changes = {};

    Object.keys(afterSnapshot).forEach(objectType => {
      const beforeRecords = beforeSnapshot[objectType] || [];
      const afterRecords = afterSnapshot[objectType] || [];
      
      const beforeIds = new Set(beforeRecords.map(r => r.Id));
      const newRecords = afterRecords.filter(r => !beforeIds.has(r.Id));
      
      const updatedRecords = afterRecords.filter(afterRecord => {
        const beforeRecord = beforeRecords.find(r => r.Id === afterRecord.Id);
        return beforeRecord && afterRecord.LastModifiedDate !== beforeRecord.LastModifiedDate;
      });

      if (newRecords.length > 0 || updatedRecords.length > 0) {
        changes[objectType] = {
          newRecords: newRecords.length,
          updatedRecords: updatedRecords.length,
          newRecordIds: newRecords.map(r => r.Id),
          updatedRecordIds: updatedRecords.map(r => r.Id)
        };
      }
    });

    return changes;
  }

  // Test connection method for the new approach
  async testConnection() {
    try {
      const result = await this.generateUnauthenticatedToken();
      return {
        success: true,
        message: 'Successfully generated MIAW unauthenticated token',
        endpointUrl: this.endpointUrl,
        hasConfiguration: !!this.configuration
      };
    } catch (error) {
      throw error;
    }
  }
}

// Persistent SSE session for multi-turn conversations
class MIAWConversationSession {
  constructor(salesforceClient) {
    this.client = salesforceClient;
    this.connection = null;
    this.eventBuffer = '';
    this.pendingResponses = [];
    this.isConnected = false;
    this.messageWaiters = [];
  }

  async initialize() {
    console.log('Initializing persistent SSE session...');
    
    return new Promise((resolve, reject) => {
      const sseUrl = new URL(`${this.client.endpointUrl}/eventrouter/v1/sse`);
      sseUrl.searchParams.append('channelPlatformKey', this.client.channelAddressIdentifier);
      sseUrl.searchParams.append('channelType', 'embedded_messaging');
      sseUrl.searchParams.append('channelAddressIdentifier', this.client.channelAddressIdentifier);
      sseUrl.searchParams.append('conversationId', this.client.conversationId.toLowerCase());

      console.log('Persistent SSE URL:', sseUrl.toString());

      const https = require('https');
      const http = require('http');
      const protocol = sseUrl.protocol === 'https:' ? https : http;
      
      const options = {
        hostname: sseUrl.hostname,
        port: sseUrl.port || (sseUrl.protocol === 'https:' ? 443 : 80),
        path: sseUrl.pathname + sseUrl.search,
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
          'Authorization': `Bearer ${this.client.accessToken}`,
          'X-Org-Id': this.client.miawConfig.orgId,
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'User-Agent': 'MIAW-Persistent-SSE-Client/1.0'
        },
        keepAlive: true,
        keepAliveMsecs: 60000,
        timeout: 60000
      };

      this.connection = protocol.request(options, (res) => {
        console.log('Persistent SSE connection established, status:', res.statusCode);
        
        if (res.statusCode !== 200) {
          reject(new Error(`SSE connection failed: ${res.statusCode} ${res.statusMessage}`));
          return;
        }

        this.isConnected = true;
        res.setEncoding('utf8');
        
        res.on('data', (chunk) => {
          this.handleIncomingData(chunk);
        });

        res.on('end', () => {
          console.log('Persistent SSE connection ended');
          this.isConnected = false;
          this.rejectAllWaiters(new Error('SSE connection ended'));
        });

        res.on('error', (error) => {
          console.error('Persistent SSE stream error:', error);
          this.isConnected = false;
          this.rejectAllWaiters(error);
        });

        resolve();
      });

      this.connection.on('error', (error) => {
        console.error('Persistent SSE request error:', error);
        this.isConnected = false;
        reject(error);
      });

      this.connection.on('timeout', () => {
        console.error('Persistent SSE request timeout');
        this.isConnected = false;
        reject(new Error('SSE request timeout'));
      });

      this.connection.end();
    });
  }

  handleIncomingData(chunk) {
    this.eventBuffer += chunk;
    console.log('Persistent SSE data received:', chunk);
    
    // Check for direct JSON responses (AI Agent messages)
    const trimmedChunk = chunk.trim();
    if (trimmedChunk.startsWith('{') && trimmedChunk.endsWith('}')) {
      try {
        const responseData = JSON.parse(trimmedChunk);
        console.log('Direct JSON response detected in persistent session');
        
        const message = this.parseAIAgentMessage(responseData);
        if (message) {
          console.log('AI Agent message parsed:', message.text);
          this.resolveNextWaiter(message.text);
        }
      } catch (e) {
        console.log('Not valid JSON, processing as SSE event');
      }
    }
    
    // Also handle standard SSE events
    const events = this.client.parseSSEEventsFromBuffer(this.eventBuffer);
    for (const event of events.complete) {
      this.processSSEEvent(event);
    }
    this.eventBuffer = events.remaining;
  }

  parseAIAgentMessage(responseData) {
    if (!responseData.conversationEntry) return null;
    
    const senderRole = responseData.conversationEntry.sender?.role;
    const senderDisplayName = responseData.conversationEntry.senderDisplayName;
    const entryType = responseData.conversationEntry.entryType;
    
    // Check if this is a message from AI Agent
    if (entryType === 'Message' && senderRole && senderRole !== 'EndUser') {
      try {
        const payload = JSON.parse(responseData.conversationEntry.entryPayload);
        const messageText = payload.abstractMessage?.staticContent?.text || 'No text content';
        
        return {
          text: messageText,
          id: responseData.conversationEntry.identifier,
          sender: senderDisplayName,
          role: senderRole,
          timestamp: new Date(responseData.conversationEntry.transcriptedTimestamp).toISOString()
        };
      } catch (e) {
        console.error('Error parsing AI Agent message:', e);
        return null;
      }
    }
    
    return null;
  }

  processSSEEvent(event) {
    if (event.type === 'ping' || !event.type) {
      console.log('Received keepalive ping in persistent session');
      return;
    }
    
    console.log('Processing SSE event in persistent session:', event.type);
    
    if (event.type === 'CONVERSATION_MESSAGE' && event.data) {
      const message = this.parseAIAgentMessage(event.data);
      if (message) {
        console.log('AI Agent message from SSE event:', message.text);
        this.resolveNextWaiter(message.text);
      }
    }
  }

  async waitForResponse(timeoutMs = 30000) {
    if (!this.isConnected) {
      throw new Error('SSE session not connected');
    }

    return new Promise((resolve, reject) => {
      // Add to waiters queue
      const waiter = { resolve, reject };
      this.messageWaiters.push(waiter);
      
      // Set timeout
      const timeout = setTimeout(() => {
        const index = this.messageWaiters.indexOf(waiter);
        if (index !== -1) {
          this.messageWaiters.splice(index, 1);
          reject(new Error('Timeout waiting for AI Agent response'));
        }
      }, timeoutMs);
      
      waiter.timeout = timeout;
    });
  }

  resolveNextWaiter(messageText) {
    if (this.messageWaiters.length > 0) {
      const waiter = this.messageWaiters.shift();
      clearTimeout(waiter.timeout);
      waiter.resolve(messageText);
    }
  }

  rejectAllWaiters(error) {
    while (this.messageWaiters.length > 0) {
      const waiter = this.messageWaiters.shift();
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
  }

  async close() {
    console.log('Closing persistent SSE session...');
    this.isConnected = false;
    
    if (this.connection) {
      this.connection.destroy();
    }
    
    this.rejectAllWaiters(new Error('Session closed'));
  }

  async cleanup() {
    console.log('Cleaning up conversation session...');
    
    // Close the SSE connection first
    await this.close();
    
    // End the messaging session properly
    if (this.client && this.client.endMessagingSession) {
      try {
        await this.client.endMessagingSession();
      } catch (error) {
        console.error('Error during session cleanup:', error);
      }
    }
  }
}

module.exports = SalesforceClient;