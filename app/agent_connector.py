import uuid
import traceback
import logging
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field
import requests

logger = logging.getLogger(__name__)

@dataclass
class AgentConfig:
    """Configuration for Salesforce AI Agent API."""
    sf_api_host: str = "https://api.salesforce.com"
    sf_org_domain: str = ""
    client_id: str = ""
    client_secret: str = ""
    agent_id: str = ""

class AgentConnector:
    """Connector for interacting with the Salesforce AI Agent API."""
    
    def __init__(self, org_domain=None, client_id=None, client_secret=None, agent_id=None, config=None):
        """Initialize the connector with required credentials or config object."""
        if config is not None:
            self.config = config
        else:
            self.config = AgentConfig(
                sf_org_domain=org_domain,
                client_id=client_id,
                client_secret=client_secret,
                agent_id=agent_id
            )
        self.access_token = None
        self.session_id = None
    
    def _get_auth_token(self) -> str:
        """Get an OAuth 2.0 access token from Salesforce."""
        token_url = f"{self.config.sf_org_domain}/services/oauth2/token"
        data = {
            'grant_type': 'client_credentials',
            'client_id': self.config.client_id,
            'client_secret': self.config.client_secret
        }
        
        try:
            response = requests.post(token_url, data=data)
            response.raise_for_status()
            
            self.access_token = response.json()['access_token']
            return self.access_token
        except requests.exceptions.RequestException as e:
            logger.error(f"Authentication failed: {str(e)}")
            raise
    
    def _get_headers(self) -> Dict[str, str]:
        """Get HTTP headers with authentication for API requests."""
        if not self.access_token:
            self._get_auth_token()
        
        return {
            'Authorization': f'Bearer {self.access_token}',
            'Content-Type': 'application/json'
        }
    
    def start_session(self, external_session_key: Optional[str] = None) -> Dict[str, Any]:
        """Initialize a new session with the AI Agent.
        
        Args:
            external_session_key (str, optional): Optional external session identifier
            
        Returns:
            dict: Session information
        """
        url = f"{self.config.sf_api_host}/einstein/ai-agent/v1/agents/{self.config.agent_id}/sessions"
        
        payload = {
            "externalSessionKey": external_session_key or str(uuid.uuid4()),
            "instanceConfig": {
                "endpoint": self.config.sf_org_domain
            },
            "variables": [],
            "streamingCapabilities": {
                "chunkTypes": ["Text"]
            },
            "bypassUser": True
        }
        
        try:
            response = requests.post(url, headers=self._get_headers(), json=payload)
            response.raise_for_status()
            
            data = response.json()
            self.session_id = data['sessionId']
            return data
        except requests.exceptions.RequestException as e:
            logger.error(f"Failed to start session: {str(e)}")
            raise
    
    def send_message(self, message: str, conversation_history=None, stream: bool = False) -> Dict[str, Any]:
        """Send a message to the AI Agent and get a response.
        
        Args:
            message (str): The message to send to the agent
            conversation_history (list, optional): Previous messages in the conversation (not used in this implementation)
            stream (bool, optional): Whether to stream the response
            
        Returns:
            dict: The response from the agent
        """
        if not self.session_id:
            raise ValueError("No active session. Call start_session() first.")
        
        endpoint = "messages/stream" if stream else "messages"
        url = f"{self.config.sf_api_host}/einstein/ai-agent/v1/sessions/{self.session_id}/{endpoint}"
        
        payload = {
            "message": {
                "sequenceId": int(uuid.uuid1().time),
                "type": "Text",
                "text": message
            },
            "variables": []
        }
        
        headers = self._get_headers()
        if stream:
            headers['Accept'] = 'text/event-stream'
        
        try:
            response = requests.post(url, headers=headers, json=payload, stream=stream)
            response.raise_for_status()
            
            if stream:
                return {"stream": [line.decode("utf-8") for line in response.iter_lines() if line]}
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"Failed to send message: {str(e)}")
            raise
    
    def end_session(self, reason: str = "UserRequest") -> Dict[str, Any]:
        """End the current session with the AI Agent.
        
        Args:
            reason (str): Reason for ending the session
            
        Returns:
            dict: Response from the API
        """
        if not self.session_id:
            raise ValueError("No active session to end.")
        
        url = f"{self.config.sf_api_host}/einstein/ai-agent/v1/sessions/{self.session_id}"
        headers = self._get_headers()
        headers['x-session-end-reason'] = reason
        
        try:
            response = requests.delete(url, headers=headers)
            response.raise_for_status()
            
            self.session_id = None
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"Failed to end session: {str(e)}")
            raise

def extract_response_text(response_json: Dict[str, Any]) -> str:
    """Extract text from a structured agent response.
    
    Args:
        response_json (dict): Response from the agent
        
    Returns:
        str: Extracted text from the response
    """
    if "messages" in response_json and len(response_json["messages"]) > 0:
        all_messages = []
        for msg in response_json["messages"]:
            if "message" in msg:
                all_messages.append(msg["message"])
        return "\n".join(all_messages)
    return str(response_json)