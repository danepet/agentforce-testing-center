const API_BASE = '/api';

let goals = [];
let testSessions = [];
let projects = [];
let currentProject = null;
let activeBatchRun = null;
let currentUser = null;

// Goal templates for easy getting started
const goalTemplates = {
    'case-creation': {
        name: 'Create Support Case',
        description: 'Test creating a new customer support case with proper assignment',
        steps: [
            'Greet the agent and explain you need help',
            'Describe a technical issue with a product',
            'Provide contact information when asked',
            'Confirm case details and priority'
        ],
        validationCriteria: [
            'New Case record created in Salesforce',
            'Case has correct Status (New or Open)',
            'Case is assigned to appropriate queue',
            'Contact record linked to case'
        ]
    },
    'lead-qualification': {
        name: 'Lead Qualification Process',
        description: 'Test the lead qualification and scoring process',
        steps: [
            'Express interest in a product or service',
            'Provide company information when asked',
            'Answer budget-related questions',
            'Discuss timeline and decision-making process'
        ],
        validationCriteria: [
            'New Lead record created',
            'Lead Score populated and above threshold',
            'Lead Status updated to "Qualified"',
            'Follow-up task created for sales team'
        ]
    },
    'order-status': {
        name: 'Order Status Inquiry',
        description: 'Test checking order status and providing updates',
        steps: [
            'Ask about an existing order status',
            'Provide order number or customer details',
            'Request specific information about delivery',
            'Ask about any issues or modifications'
        ],
        validationCriteria: [
            'Order record accessed successfully',
            'Accurate status information provided',
            'Delivery tracking details shared',
            'Case created if issues reported'
        ]
    },
    'account-update': {
        name: 'Account Information Update',
        description: 'Test updating customer account information',
        steps: [
            'Request to update account information',
            'Provide authentication/verification details',
            'Specify what information needs updating',
            'Confirm changes made'
        ],
        validationCriteria: [
            'Account record updated with new information',
            'Change history tracked properly',
            'Verification process completed',
            'Confirmation sent to customer'
        ]
    },
    'product-inquiry': {
        name: 'Product Information Request',
        description: 'Test getting detailed product information and recommendations',
        steps: [
            'Ask about specific product features',
            'Discuss use case and requirements',
            'Request pricing information',
            'Ask for product comparisons'
        ],
        validationCriteria: [
            'Accurate product information provided',
            'Relevant recommendations given',
            'Pricing details shared appropriately',
            'Follow-up opportunity created'
        ]
    }
};

// Authentication functions
async function checkAuthStatus() {
    try {
        const response = await fetch('/auth/status', { credentials: 'include' });
        const data = await response.json();
        
        if (data.authenticated) {
            currentUser = data.user;
            showAuthenticatedState();
            return true;
        } else {
            currentUser = null;
            showUnauthenticatedState();
            return false;
        }
    } catch (error) {
        console.error('Error checking auth status:', error);
        showUnauthenticatedState();
        return false;
    }
}

function showAuthenticatedState() {
    const authLoading = document.getElementById('auth-loading');
    const authLogin = document.getElementById('auth-login');
    const authUser = document.getElementById('auth-user');
    
    authLoading.style.display = 'none';
    authLogin.style.display = 'none';
    authUser.style.display = 'block';
    
    const userAvatar = document.getElementById('user-avatar');
    const userName = document.getElementById('user-name');
    
    if (currentUser.picture) {
        userAvatar.src = currentUser.picture;
        userAvatar.style.display = 'block';
    } else {
        userAvatar.style.display = 'none';
    }
    
    userName.textContent = currentUser.name || currentUser.email;
}

function showUnauthenticatedState() {
    const authLoading = document.getElementById('auth-loading');
    const authLogin = document.getElementById('auth-login');
    const authUser = document.getElementById('auth-user');
    
    authLoading.style.display = 'none';
    authLogin.style.display = 'block';
    authUser.style.display = 'none';
}

function login() {
    window.location.href = '/auth/google';
}

async function logout() {
    try {
        const response = await fetch('/auth/logout', { 
            method: 'POST', 
            credentials: 'include' 
        });
        
        if (response.ok) {
            const data = await response.json();
            // Redirect to login page
            window.location.href = data.redirect || '/login';
        } else {
            console.error('Logout failed');
            // Fallback redirect
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('Error logging out:', error);
        // Fallback redirect on error
        window.location.href = '/login';
    }
}

document.addEventListener('DOMContentLoaded', async function() {
    // Check authentication and show user info
    const isAuthenticated = await checkAuthStatus();
    
    if (!isAuthenticated) {
        // If not authenticated, redirect to login
        window.location.href = '/login';
        return;
    }
    
    // Load projects since user is authenticated
    loadProjects();
    
    const projectForm = document.getElementById('projectForm');
    if (projectForm) {
        projectForm.addEventListener('submit', handleProjectSubmit);
    }
    
    const addGoalForm = document.getElementById('addGoalForm');
    if (addGoalForm) {
        addGoalForm.addEventListener('submit', handleAddGoalSubmit);
    }
});

// Cleanup when the page is being unloaded
window.addEventListener('beforeunload', function() {
    // Stop admin auto-refresh
    stopAdminAutoRefresh();
    
    // Clear any monitoring flags
    isMonitoringProgress = false;
    isPollingProjectProgress = false;
    
    // Reset current jobs to prevent zombie polling
    currentProcessingJob = null;
    projectCurrentProcessingJob = null;
});

function showTab(tabName) {
    const tabs = document.querySelectorAll('.tab-content');
    const buttons = document.querySelectorAll('.tab-button');
    
    tabs.forEach(tab => tab.classList.remove('active'));
    buttons.forEach(button => button.classList.remove('active'));
    
    const targetTab = document.getElementById(`${tabName}-tab`);
    if (targetTab) {
        targetTab.classList.add('active');
    }
    
    const targetButton = document.querySelector(`[onclick="showTab('${tabName}')"]`);
    if (targetButton) {
        targetButton.classList.add('active');
    }
    
    // Handle tab-specific initialization
    if (tabName === 'admin') {
        // Initialize admin tab
        refreshSystemStatus();
        startAdminAutoRefresh();
    } else {
        stopAdminAutoRefresh();
    }
    
    if (tabName === 'conversations') {
        // Initialize conversation import tab
        initializeConversationImport();
    }
}



async function runTest(goalId) {
    const loadingId = showLoadingOverlay('Initializing Test Session...', [
        { label: 'Initialize', status: 'active' },
        { label: 'Execute', status: 'pending' },
        { label: 'Validate', status: 'pending' },
        { label: 'Complete', status: 'pending' }
    ]);

    try {
        updateLoadingProgress(loadingId, 'Starting test session...', 0);
        
        const response = await fetch(`${API_BASE}/tests/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ goalId })
        });
        
        if (response.ok) {
            const session = await response.json();
            
            updateLoadingProgress(loadingId, 'Executing conversation with Agentforce...', 25, [
                { label: 'Initialize', status: 'completed' },
                { label: 'Execute', status: 'active' },
                { label: 'Validate', status: 'pending' },
                { label: 'Complete', status: 'pending' }
            ]);
            
            const runResponse = await fetch(`${API_BASE}/tests/${session.id}/run`, {
                method: 'POST'
            });
            
            updateLoadingProgress(loadingId, 'Validating results...', 75, [
                { label: 'Initialize', status: 'completed' },
                { label: 'Execute', status: 'completed' },
                { label: 'Validate', status: 'active' },
                { label: 'Complete', status: 'pending' }
            ]);
            
            if (runResponse.ok) {
                const results = await runResponse.json();
                
                updateLoadingProgress(loadingId, 'Test completed successfully!', 100, [
                    { label: 'Initialize', status: 'completed' },
                    { label: 'Execute', status: 'completed' },
                    { label: 'Validate', status: 'completed' },
                    { label: 'Complete', status: 'completed' }
                ]);
                
                setTimeout(() => {
                    hideLoadingOverlay(loadingId);
                    showTestResults(results);
                    loadTestSessions();
                    showNotification(`Test completed! Score: ${Math.round(results.score || 0)}%`, 'success');
                }, 1000);
            } else {
                const error = await runResponse.json();
                hideLoadingOverlay(loadingId);
                showNotification('Test failed: ' + error.error, 'error');
            }
        } else {
            hideLoadingOverlay(loadingId);
            const error = await response.json();
            showNotification('Failed to start test: ' + error.error, 'error');
        }
    } catch (error) {
        hideLoadingOverlay(loadingId);
        showNotification('Error running test: ' + error.message, 'error');
    }
}



async function showTestDetails(sessionId) {
    try {
        const response = await fetch(`${API_BASE}/tests/${sessionId}`);
        const session = await response.json();
        
        const modal = document.getElementById('test-modal');
        const details = document.getElementById('test-details');
        
        details.innerHTML = `
            <h3>${escapeHtml(session.goalName || 'Test Session')}</h3>
            <p><strong>Status:</strong> <span class="test-status status-${session.status}">${session.status}</span></p>
            <p><strong>Score:</strong> ${session.score !== null ? Math.round(session.score) + '%' : 'Not available'}</p>
            
            ${session.conversationLog && session.conversationLog.length > 0 ? `
                <h4>💬 Conversation Log:</h4>
                <div class="conversation-log">
                    ${session.conversationLog.map((msg, index) => `
                        <div class="message ${msg.sender === 'TestingAgent' ? 'user-message' : 'agent-message'}">
                            <div class="message-avatar">
                                ${msg.sender === 'TestingAgent' ? 
                                    '<div class="avatar testing-agent">🤖</div>' : 
                                    '<div class="avatar agentforce">⚡</div>'
                                }
                            </div>
                            <div class="message-content">
                                <div class="message-header">
                                    <span class="sender-name">
                                        ${msg.sender === 'TestingAgent' ? 'Testing Agent' : 'Agentforce'}
                                    </span>
                                    ${msg.timestamp ? `<span class="timestamp">${new Date(msg.timestamp).toLocaleTimeString()}</span>` : ''}
                                </div>
                                <div class="message-text">${escapeHtml(msg.message)}</div>
                                ${msg.intent ? `<div class="message-intent">Intent: ${escapeHtml(msg.intent)}</div>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
            
            ${session.validationResults && Object.keys(session.validationResults).length > 0 ? `
                <h4>📊 Test Results:</h4>
                <div class="validation-results">
                    <div class="score-display">
                        <div class="score-circle">
                            <div class="score-percentage">${Math.round(session.validationResults.score || 0)}%</div>
                            <div class="score-label">Success Rate</div>
                        </div>
                        <div class="score-details">
                            <div class="detail-item ${session.validationResults.goalAchieved ? 'success' : 'failed'}">
                                <span class="detail-icon">${session.validationResults.goalAchieved ? '✅' : '❌'}</span>
                                <span>Goal ${session.validationResults.goalAchieved ? 'Achieved' : 'Not Achieved'}</span>
                            </div>
                        </div>
                    </div>
                    
                    ${session.validationResults.completedActions && session.validationResults.completedActions.length > 0 ? `
                        <div class="result-section">
                            <h5>✅ Completed Actions:</h5>
                            <ul class="action-list">
                                ${session.validationResults.completedActions.map(action => `
                                    <li class="action-item success">${escapeHtml(action)}</li>
                                `).join('')}
                            </ul>
                        </div>
                    ` : ''}
                    
                    
                    ${session.validationResults.issues && session.validationResults.issues.length > 0 ? `
                        <div class="result-section">
                            <h5>⚠️ Issues Found:</h5>
                            <ul class="action-list">
                                ${session.validationResults.issues.map(issue => `
                                    <li class="action-item warning">${escapeHtml(issue)}</li>
                                `).join('')}
                            </ul>
                        </div>
                    ` : ''}
                    
                    ${session.validationResults.summary ? `
                        <div class="result-section">
                            <h5>📝 Summary:</h5>
                            <div class="summary-text">${escapeHtml(session.validationResults.summary)}</div>
                        </div>
                    ` : ''}
                </div>
            ` : ''}
            
        `;
        
        modal.style.display = 'block';
    } catch (error) {
        showNotification('Error loading test details: ' + error.message, 'error');
    }
}

function closeTestModal() {
    const testModal = document.getElementById('test-modal');
    if (testModal) {
        testModal.style.display = 'none';
    }
}

async function deleteGoal(goalId) {
    if (!confirm('Are you sure you want to delete this goal?')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/goals/${goalId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            loadGoals();
            showNotification('Goal deleted successfully!', 'success');
        } else {
            const error = await response.json();
            showNotification('Failed to delete goal: ' + error.error, 'error');
        }
    } catch (error) {
        showNotification('Error deleting goal: ' + error.message, 'error');
    }
}

async function deleteTestSession(sessionId) {
    if (!confirm('Are you sure you want to delete this test session?')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/tests/${sessionId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            loadTestSessions();
            showNotification('Test session deleted successfully!', 'success');
        } else {
            const error = await response.json();
            showNotification('Failed to delete test session: ' + error.error, 'error');
        }
    } catch (error) {
        showNotification('Error deleting test session: ' + error.message, 'error');
    }
}


async function testSalesforceConnection() {
    const status = document.getElementById('sf-status');
    status.textContent = 'Testing...';
    status.className = 'status';
    
    try {
        const response = await fetch(`${API_BASE}/agent/test-connection`, {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (result.status === 'success') {
            status.textContent = 'Connected ✓';
            status.className = 'status success';
        } else {
            status.textContent = 'Failed ✗';
            status.className = 'status error';
        }
    } catch (error) {
        status.textContent = 'Error ✗';
        status.className = 'status error';
    }
}

async function testOpenAIConnection() {
    const status = document.getElementById('openai-status');
    status.textContent = 'Testing...';
    status.className = 'status';
    
    try {
        const response = await fetch(`${API_BASE}/agent/test-openai`, {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (result.status === 'success') {
            status.textContent = 'Connected ✓';
            status.className = 'status success';
        } else {
            status.textContent = 'Failed ✗';
            status.className = 'status error';
        }
    } catch (error) {
        status.textContent = 'Error ✗';
        status.className = 'status error';
    }
}

async function testMessaging() {
    const message = document.getElementById('test-message').value;
    const status = document.getElementById('messaging-status');
    
    if (!message.trim()) {
        showNotification('Please enter a test message', 'error');
        return;
    }
    
    status.textContent = 'Sending...';
    status.className = 'status';
    
    try {
        const response = await fetch(`${API_BASE}/agent/send-message`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message })
        });
        
        const result = await response.json();
        
        if (result.status === 'success' || result.status === 'partial_success') {
            status.textContent = 'Message sent ✓';
            status.className = 'status success';
            if (result.messages && result.messages.length > 0) {
                showNotification(`Response received: ${result.messages[result.messages.length - 1].message?.text || 'No text content'}`, 'info');
            }
        } else {
            status.textContent = 'Failed ✗';
            status.className = 'status error';
        }
    } catch (error) {
        status.textContent = 'Error ✗';
        status.className = 'status error';
    }
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        background: ${type === 'success' ? '#48bb78' : type === 'error' ? '#f56565' : '#667eea'};
        color: white;
        border-radius: 6px;
        z-index: 1001;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        max-width: 300px;
        animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

function showTestResults(session) {
    showTestDetails(session.id);
}


// Loading overlay management
let loadingOverlays = {};
let loadingIdCounter = 0;

function showLoadingOverlay(message, steps = []) {
    const id = ++loadingIdCounter;
    
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.id = `loading-${id}`;
    
    overlay.innerHTML = `
        <div class="loading-content">
            <div class="spinner"></div>
            <h3 id="loading-title-${id}">${message}</h3>
            <div class="progress-bar">
                <div class="progress-bar-fill" id="progress-fill-${id}" style="width: 10%"></div>
            </div>
            ${steps.length > 0 ? `
                <div class="progress-steps" id="progress-steps-${id}">
                    ${steps.map((step, index) => `
                        <div class="progress-step ${step.status}" data-step="${index}">
                            <div class="progress-step-circle">${index + 1}</div>
                            <div class="progress-step-label">${step.label}</div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
            <p id="loading-subtitle-${id}" style="color: #718096; margin-top: 15px;">Please wait while we process your request...</p>
        </div>
    `;
    
    document.body.appendChild(overlay);
    loadingOverlays[id] = overlay;
    
    return id;
}

function updateLoadingProgress(id, message, progress, steps = null) {
    const titleEl = document.getElementById(`loading-title-${id}`);
    const progressEl = document.getElementById(`progress-fill-${id}`);
    const stepsEl = document.getElementById(`progress-steps-${id}`);
    
    if (titleEl) titleEl.textContent = message;
    if (progressEl) progressEl.style.width = `${Math.max(10, progress)}%`;
    
    if (steps && stepsEl) {
        steps.forEach((step, index) => {
            const stepEl = stepsEl.querySelector(`[data-step="${index}"]`);
            if (stepEl) {
                stepEl.className = `progress-step ${step.status}`;
            }
        });
    }
}

function hideLoadingOverlay(id) {
    const overlay = loadingOverlays[id];
    if (overlay) {
        overlay.style.animation = 'fadeOut 0.3s ease';
        setTimeout(() => {
            document.body.removeChild(overlay);
            delete loadingOverlays[id];
        }, 300);
    }
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

// Project Management Functions
async function loadProjects() {
    try {
        const response = await fetch(`${API_BASE}/projects`);
        projects = await response.json();
        displayProjects();
    } catch (error) {
        console.error('Error loading projects:', error);
        showNotification('Failed to load projects', 'error');
    }
}

function displayProjects() {
    const container = document.getElementById('projects-list');
    
    if (projects.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📁</div>
                <h3>No Projects Yet</h3>
                <p>Create your first project to organize your AI Agent tests</p>
                <button class="btn btn-primary" onclick="showProjectForm()">Create Project</button>
            </div>
        `;
        return;
    }

    container.innerHTML = projects.map(project => `
        <div class="project-card">
            <div class="project-header">
                <div class="project-title-section">
                    <h3 class="project-title">${escapeHtml(project.name)}</h3>
                    <div class="project-meta">
                        <span class="meta-item">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"/>
                                <polyline points="12,6 12,12 16,14"/>
                            </svg>
                            ${new Date(project.createdAt).toLocaleDateString()}
                        </span>
                    </div>
                </div>
                <div class="project-status">
                    <span class="status-badge ${project.status || 'active'}">${project.status || 'Active'}</span>
                </div>
            </div>
            
            <p class="project-description">${escapeHtml(project.description || 'No description provided')}</p>
            
            ${project.tags && project.tags.length > 0 ? `
                <div class="project-tags">
                    ${project.tags.slice(0, 3).map(tag => `<span class="project-tag">${escapeHtml(tag)}</span>`).join('')}
                    ${project.tags.length > 3 ? `<span class="project-tag-more">+${project.tags.length - 3}</span>` : ''}
                </div>
            ` : ''}
            
            <div class="project-stats">
                <div class="stat-item">
                    <div class="stat-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <circle cx="12" cy="12" r="6"/>
                            <circle cx="12" cy="12" r="2"/>
                        </svg>
                    </div>
                    <div>
                        <span class="stat-number">${project.goalCount || 0}</span>
                        <span class="stat-label">Goals</span>
                    </div>
                </div>
                <div class="stat-item">
                    <div class="stat-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 12l2 2 4-4"/>
                            <circle cx="12" cy="12" r="10"/>
                        </svg>
                    </div>
                    <div>
                        <span class="stat-number">${project.enabledGoals || 0}</span>
                        <span class="stat-label">Enabled</span>
                    </div>
                </div>
                <div class="stat-item">
                    <div class="stat-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                            <polyline points="14,2 14,8 20,8"/>
                        </svg>
                    </div>
                    <div>
                        <span class="stat-number">${project.testSessions || 0}</span>
                        <span class="stat-label">Tests</span>
                    </div>
                </div>
            </div>
            
            <div class="project-actions">
                <button class="btn btn-primary" onclick="openProject('${project.id}')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9 12l2 2 4-4"/>
                        <circle cx="12" cy="12" r="10"/>
                    </svg>
                    Open Project
                </button>
                <button class="btn btn-secondary" onclick="editProject('${project.id}')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                    Edit
                </button>
                <button class="btn btn-danger" onclick="deleteProject('${project.id}')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3,6 5,6 21,6"/>
                        <path d="M19,6V20a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6M8,6V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2V6"/>
                        <line x1="10" y1="11" x2="10" y2="17"/>
                        <line x1="14" y1="11" x2="14" y2="17"/>
                    </svg>
                    Delete
                </button>
            </div>
        </div>
    `).join('');
}

function showProjectForm() {
    const projectForm = document.getElementById('project-form');
    if (projectForm) {
        projectForm.style.display = 'block';
    }
    
    const projectNameInput = document.getElementById('projectName');
    if (projectNameInput) {
        projectNameInput.focus();
    }
}

function hideProjectForm() {
    const formEl = document.getElementById('project-form');
    if (formEl) {
        formEl.style.display = 'none';
        // Reset positioning styles
        formEl.style.position = '';
        formEl.style.top = '';
        formEl.style.left = '';
        formEl.style.transform = '';
        formEl.style.zIndex = '';
        formEl.style.boxShadow = '';
        formEl.style.maxWidth = '';
        formEl.style.width = '';
        formEl.style.maxHeight = '';
        formEl.style.overflowY = '';
    }
    
    // Hide backdrop
    const backdrop = document.getElementById('modal-backdrop');
    if (backdrop) {
        backdrop.style.display = 'none';
    }
    
    document.getElementById('projectForm').reset();
    
    // Reset editing state
    delete document.getElementById('projectForm').dataset.editingProjectId;
    
    // Reset form title and button text
    document.querySelector('#project-form h3').textContent = 'Create New Project';
    document.querySelector('#projectForm button[type="submit"]').innerHTML = '✅ Create Project';
    
    // Initialize routing attributes with one empty row
    populateRoutingAttributes(null);
}

async function handleProjectSubmit(event) {
    event.preventDefault();
    
    // Collect routing attributes before form submission
    const routingAttributes = collectRoutingAttributes();
    document.getElementById('miawRoutingAttributes').value = routingAttributes;
    
    const formData = new FormData(event.target);
    const tags = formData.get('projectTags') 
        ? formData.get('projectTags').split(',').map(tag => tag.trim()).filter(tag => tag)
        : [];
    
    const projectData = {
        name: formData.get('projectName'),
        description: formData.get('projectDescription'),
        tags: tags,
        miawOrgId: formData.get('miawOrgId'),
        miawDeploymentName: formData.get('miawDeploymentName'),
        miawBaseUrl: formData.get('miawBaseUrl'),
        miawRoutingAttributes: formData.get('miawRoutingAttributes')
    };

    // Check if we're editing an existing project
    const editingProjectId = event.target.dataset.editingProjectId;
    const isEditing = !!editingProjectId;

    try {
        let response;
        if (isEditing) {
            // Update existing project
            response = await fetch(`${API_BASE}/projects/${editingProjectId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(projectData)
            });
        } else {
            // Create new project
            response = await fetch(`${API_BASE}/projects`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(projectData)
            });
        }

        if (response.ok) {
            hideProjectForm();
            if (isEditing && currentProject && currentProject.id === editingProjectId) {
                // If we're editing the currently viewed project, refresh it
                await openProject(editingProjectId);
            } else {
                // Otherwise refresh the projects list
                await loadProjects();
            }
            showNotification(isEditing ? 'Project updated successfully!' : 'Project created successfully!', 'success');
        } else {
            const error = await response.json();
            showNotification(error.error || `Failed to ${isEditing ? 'update' : 'create'} project`, 'error');
        }
    } catch (error) {
        console.error(`Error ${isEditing ? 'updating' : 'creating'} project:`, error);
        showNotification(`Failed to ${isEditing ? 'update' : 'create'} project`, 'error');
    }
}

async function openProject(projectId) {
    try {
        const response = await fetch(`${API_BASE}/projects/${projectId}`);
        currentProject = await response.json();
        
        // Load batch runs for this project
        const batchRunsResponse = await fetch(`${API_BASE}/projects/${projectId}/batch-runs`);
        const batchRunsData = await batchRunsResponse.json();
        currentProject.batchRuns = batchRunsData.batchRuns;
        
        showProjectPage();
    } catch (error) {
        console.error('Error loading project:', error);
        showNotification('Failed to load project details', 'error');
    }
}

function showProjectPage() {
    if (!currentProject) return;
    
    // Hide all other tabs and show project page
    const tabs = document.querySelectorAll('.tab-content');
    const buttons = document.querySelectorAll('.tab-button');
    
    tabs.forEach(tab => tab.classList.remove('active'));
    buttons.forEach(button => button.classList.remove('active'));
    
    document.getElementById('project-page').classList.add('active');
    document.getElementById('project-page-title').textContent = currentProject.name;
    
    // Update project metadata
    const metadataElement = document.getElementById('project-metadata');
    metadataElement.innerHTML = `
        <span class="meta-item">
            <span class="meta-label">Created:</span> 
            ${new Date(currentProject.createdAt).toLocaleDateString()}
        </span>
        <span class="meta-item">
            <span class="meta-label">Goals:</span> 
            ${currentProject.goals ? currentProject.goals.length : 0}
        </span>
        ${currentProject.tags && currentProject.tags.length > 0 ? `
            <span class="meta-item">
                <span class="meta-label">Tags:</span> 
                ${currentProject.tags.map(tag => `<span class="project-tag">${escapeHtml(tag)}</span>`).join(' ')}
            </span>
        ` : ''}
    `;
    
    // Load goals into the goals grid
    loadProjectGoals();
    
    // Load batch runs
    loadProjectBatchRuns();
}

function loadProjectGoals() {
    const goalsGrid = document.getElementById('goals-grid');
    goalsGrid.innerHTML = renderGoalsGrid();
    
    // Update the run all tests button state
    const runButton = document.getElementById('run-all-tests-btn');
    if (runButton) {
        const hasEnabledGoals = currentProject.goals && currentProject.goals.some(goal => goal.enabled);
        runButton.disabled = !hasEnabledGoals;
    }
}

function loadProjectBatchRuns() {
    if (!currentProject || !currentProject.batchRuns) return;
    
    // Update the batch runs display  
    document.getElementById('project-test-sessions').innerHTML = renderProjectBatchRuns();
}

function backToProjects() {
    showTab('projects');
    currentProject = null;
}

async function loadProjectBatchRuns() {
    if (!currentProject) return;
    
    try {
        const response = await fetch(`${API_BASE}/projects/${currentProject.id}/batch-runs`);
        const batchRunsData = await response.json();
        currentProject.batchRuns = batchRunsData.batchRuns;
        
        // Update the batch runs display
        document.getElementById('project-test-sessions').innerHTML = renderProjectBatchRuns();
        showNotification('Batch runs refreshed!', 'info');
    } catch (error) {
        showNotification('Error loading batch runs: ' + error.message, 'error');
    }
}

async function loadProjectTestSessions() {
    if (!currentProject) {
        showNotification('No project selected', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/projects/${currentProject.id}/test-sessions`);
        if (!response.ok) {
            throw new Error(`Failed to fetch test sessions: ${response.statusText}`);
        }
        const testSessions = await response.json();
        
        // Update the test sessions display
        const testSessionsElement = document.getElementById('project-test-sessions');
        if (testSessionsElement) {
            testSessionsElement.innerHTML = renderTestSessions(testSessions);
        }
        
        showNotification('Test sessions loaded successfully', 'success');
    } catch (error) {
        console.error('Error loading test sessions:', error);
        showNotification('Failed to load test sessions', 'error');
    }
}

function renderTestSessions(testSessions) {
    if (!testSessions || testSessions.length === 0) {
        return `
            <div class="empty-state">
                <div class="empty-icon">🧪</div>
                <h3>No Test Sessions</h3>
                <p>No test sessions have been run for this project yet.</p>
            </div>
        `;
    }
    
    return testSessions.map(session => `
        <div class="test-session-card">
            <div class="test-session-header">
                <h4>${escapeHtml(session.goalName || 'Unknown Goal')}</h4>
                <span class="test-status ${session.status}">${session.status}</span>
            </div>
            <div class="test-session-details">
                <p><strong>Score:</strong> ${session.score || 0}%</p>
                <p><strong>Duration:</strong> ${session.duration ? Math.round(session.duration / 1000 / 60) : 'N/A'} min</p>
                <p><strong>Started:</strong> ${new Date(session.createdAt).toLocaleString()}</p>
                ${session.endReason ? `<p><strong>End Reason:</strong> ${escapeHtml(session.endReason)}</p>` : ''}
            </div>
            <div class="test-session-actions">
                <button class="btn btn-secondary btn-sm" onclick="showTestSessionDetails('${session.id}')">View Details</button>
            </div>
        </div>
    `).join('');
}

function renderProjectBatchRuns() {
    if (!currentProject.batchRuns || currentProject.batchRuns.length === 0) {
        return `
            <div class="empty-state">
                <div class="empty-icon">📊</div>
                <h4>No Batch Runs Yet</h4>
                <p>Run batch tests on your goals to see results here</p>
            </div>
        `;
    }
    
    return `
        <div class="batch-runs-list">
            ${currentProject.batchRuns.map(batchRun => `
                <div class="batch-run-card">
                    <div class="batch-run-header">
                        <div>
                            <h4>${escapeHtml(batchRun.name || 'Unnamed Batch Run')}</h4>
                            <p>Project: ${escapeHtml(batchRun.projectName || 'Unknown Project')}</p>
                        </div>
                        <div style="text-align: right;">
                            <div class="test-status status-${batchRun.status}">
                                ${batchRun.status}
                            </div>
                            ${batchRun.successRate !== null ? `<div class="test-score">${Math.round(batchRun.successRate)}% success</div>` : ''}
                        </div>
                    </div>
                    
                    <div class="batch-run-stats">
                        <div class="stat-item">
                            <span class="stat-label">Total Tests:</span>
                            <span class="stat-value">${batchRun.totalTestCases}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Completed:</span>
                            <span class="stat-value">${batchRun.completedTestCases}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Progress:</span>
                            <span class="stat-value">${Math.round((batchRun.completedTestCases / batchRun.totalTestCases) * 100)}%</span>
                        </div>
                    </div>
                    
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 15px;">
                        <div style="font-size: 0.9rem; color: #718096;">
                            Started: ${new Date(batchRun.startedAt || batchRun.started_at).toLocaleString()}
                            ${batchRun.completedAt || batchRun.completed_at ? 
                                `<br>Completed: ${new Date(batchRun.completedAt || batchRun.completed_at).toLocaleString()}` 
                                : ''
                            }
                        </div>
                        <div>
                            <button class="btn btn-secondary" onclick="toggleBatchRunDetails('${batchRun.id}')">
                                <span id="toggle-text-${batchRun.id}">View Results</span>
                                <span id="toggle-icon-${batchRun.id}">▼</span>
                            </button>
                            ${batchRun.status === 'completed' ? 
                                `<button class="btn btn-primary" onclick="exportBatchRunCSV('${batchRun.id}', '${escapeHtml(batchRun.name).replace(/'/g, "\\'")}')">📊 Export CSV</button>` : 
                                ''
                            }
                            ${batchRun.status === 'running' ? 
                                `<button class="btn btn-warning" onclick="stopBatchRun('${batchRun.id}')">Stop</button>` : 
                                `<button class="btn btn-danger" onclick="deleteBatchRun('${batchRun.id}')">Delete</button>`
                            }
                        </div>
                    </div>
                    
                    <!-- Expandable test sessions section -->
                    <div id="batch-details-${batchRun.id}" class="batch-details-section" style="display: none;">
                        <div class="loading-spinner" id="loading-${batchRun.id}">
                            Loading test sessions...
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderGoalsGrid() {
    if (!currentProject.goals || currentProject.goals.length === 0) {
        return `
            <div class="empty-state">
                <div class="empty-icon">🎯</div>
                <h3>No Goals Yet</h3>
                <p>Add your first goal to start testing with this project</p>
                <button class="btn btn-primary" onclick="addGoalToProject()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M5 12h14"/>
                        <path d="M12 5v14"/>
                    </svg>
                    Add First Goal
                </button>
            </div>
        `;
    }
    
    return currentProject.goals.map(goal => `
        <div class="goal-card">
            <div class="goal-header">
                <h3>${escapeHtml(goal.name)}</h3>
                <div class="goal-status">
                    <label class="enabled-toggle">
                        <input type="checkbox" ${goal.enabled ? 'checked' : ''} 
                               onchange="toggleGoal('${goal.id}', this.checked)">
                        <span class="toggle-slider"></span>
                    </label>
                </div>
            </div>
            
            <p class="goal-description">${escapeHtml(goal.description || 'No description provided')}</p>
            
            <div class="goal-meta">
                <div class="meta-stats">
                    <span class="meta-item">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 11H3l2-5h4v19a2 2 0 0 0 2 2h4l2-5H9"/>
                        </svg>
                        ${goal.steps ? goal.steps.length : 0} steps
                    </span>
                    <span class="meta-item">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 12l2 2 4-4"/>
                            <circle cx="12" cy="12" r="10"/>
                        </svg>
                        ${goal.validationCriteria ? goal.validationCriteria.length : 0} criteria
                    </span>
                </div>
            </div>
            
            ${goal.steps && goal.steps.length > 0 ? `
                <div class="goal-steps">
                    <h4>Test Steps</h4>
                    <ul>
                        ${goal.steps.slice(0, 3).map(step => `<li>${escapeHtml(step)}</li>`).join('')}
                        ${goal.steps.length > 3 ? `<li><em>+${goal.steps.length - 3} more steps...</em></li>` : ''}
                    </ul>
                </div>
            ` : ''}
            
            ${goal.validationCriteria && goal.validationCriteria.length > 0 ? `
                <div class="goal-validation">
                    <h4>Success Criteria</h4>
                    <ul>
                        ${goal.validationCriteria.slice(0, 2).map(criteria => `<li>${escapeHtml(criteria)}</li>`).join('')}
                        ${goal.validationCriteria.length > 2 ? `<li><em>+${goal.validationCriteria.length - 2} more criteria...</em></li>` : ''}
                    </ul>
                </div>
            ` : ''}
            
            <div class="goal-actions">
                <button class="btn btn-primary" onclick="runTest('${goal.id}')" ${!goal.enabled ? 'disabled' : ''}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                    Run Test
                </button>
                <button class="btn btn-secondary" onclick="editGoal('${goal.id}')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                    Edit
                </button>
                <button class="btn btn-danger" onclick="removeGoalFromProject('${goal.id}')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18"/>
                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                    </svg>
                    Remove
                </button>
            </div>
        </div>
    `).join('');
}

function renderRecentBatchRuns() {
    if (!currentProject.recentBatchRuns || currentProject.recentBatchRuns.length === 0) {
        return `
            <div class="recent-runs">
                <h4>Recent Batch Runs</h4>
                <p>No batch runs yet. Start your first batch test above.</p>
            </div>
        `;
    }
    
    return `
        <div class="recent-runs">
            <h4>Recent Batch Runs</h4>
            ${currentProject.recentBatchRuns.map(run => `
                <div class="run-item">
                    <div>
                        <div class="run-name">${escapeHtml(run.name)}</div>
                        <small>${new Date(run.startedAt).toLocaleString()}</small>
                    </div>
                    <div class="run-stats">
                        <span>Status: ${run.status}</span>
                        <span>Success: ${run.successRate}%</span>
                        <span>Tests: ${run.completedTestCases}/${run.totalTestCases}</span>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}


async function startBatchRun() {
    if (!currentProject) return;
    
    const batchRunName = document.getElementById('batchRunName').value;
    const maxConcurrency = parseInt(document.getElementById('maxConcurrency').value);
    
    // Show progress inline immediately with loading state
    const liveProgress = document.getElementById('live-progress');
    liveProgress.innerHTML = `
        <div class="live-progress-header">
            <h3>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                Starting Batch Test Run...
            </h3>
            <button class="btn btn-secondary btn-sm" onclick="stopBatchRun()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <square x="6" y="6" width="12" height="12"/>
                </svg>
                Stop
            </button>
        </div>
        <div class="batch-status">
            <div class="progress-spinner"></div>
            <p>Initializing test execution...</p>
        </div>
    `;
    liveProgress.style.display = 'block';
    
    // Disable the run button
    const runButton = document.getElementById('run-all-tests-btn');
    if (runButton) {
        runButton.disabled = true;
        runButton.classList.add('loading');
    }
    
    try {
        const response = await fetch(`${API_BASE}/projects/${currentProject.id}/batch-run`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: batchRunName || `Batch Run ${new Date().toLocaleString()}`,
                maxConcurrency
            })
        });
        
        if (response.ok) {
            const result = await response.json();
            activeBatchRun = result.batchRunId;
            showNotification('Batch test run started!', 'success');
            
            // Start monitoring with real-time updates
            monitorBatchRunWithSSE(result.batchRunId);
        } else {
            const error = await response.json();
            showNotification(error.error || 'Failed to start batch run', 'error');
            hideLiveProgress();
        }
    } catch (error) {
        console.error('Error starting batch run:', error);
        showNotification('Failed to start batch run', 'error');
        hideLiveProgress();
    }
}

function hideLiveProgress() {
    const liveProgress = document.getElementById('live-progress');
    liveProgress.style.display = 'none';
    liveProgress.innerHTML = '';
    
    // Re-enable the run button
    const runButton = document.getElementById('run-all-tests-btn');
    if (runButton) {
        runButton.disabled = false;
        runButton.classList.remove('loading');
    }
    
    activeBatchRun = null;
}

async function stopBatchRun() {
    if (!activeBatchRun) return;
    
    try {
        const response = await fetch(`${API_BASE}/projects/batch-runs/${activeBatchRun}/stop`, {
            method: 'POST'
        });
        
        if (response.ok) {
            showNotification('Batch run stopped', 'info');
            hideLiveProgress();
        } else {
            showNotification('Failed to stop batch run', 'error');
        }
    } catch (error) {
        console.error('Error stopping batch run:', error);
        showNotification('Failed to stop batch run', 'error');
    }
}

function showBatchMonitor(batchRunId) {
    // This function is deprecated - now using inline progress monitoring
    console.log('showBatchMonitor is deprecated - using inline progress monitoring');
}

async function monitorBatchRun(batchRunId) {
    const content = document.getElementById('batch-monitor-content');
    
    try {
        const response = await fetch(`${API_BASE}/projects/batch-runs/${batchRunId}/status`);
        const data = await response.json();
        
        content.innerHTML = `
            <div class="batch-status">
                <h3>Status: ${data.batchRun.status}</h3>
                <div class="batch-progress">
                    <div class="batch-progress-fill" style="width: ${getProgressPercentage(data.batchRun)}%"></div>
                </div>
                <span>${data.batchRun.completedTestCases} / ${data.batchRun.totalTestCases} tests completed</span>
            </div>
            
            <div class="batch-stats">
                <div class="batch-stat">
                    <div class="stat-number">${data.batchRun.totalTestCases}</div>
                    <div class="stat-label">Total Tests</div>
                </div>
                <div class="batch-stat">
                    <div class="stat-number">${data.batchRun.completedTestCases}</div>
                    <div class="stat-label">Completed</div>
                </div>
                <div class="batch-stat">
                    <div class="stat-number">${data.batchRun.successRate}%</div>
                    <div class="stat-label">Success Rate</div>
                </div>
                ${data.progress ? `
                    <div class="batch-stat">
                        <div class="stat-number">${data.progress.queueLength}</div>
                        <div class="stat-label">In Queue</div>
                    </div>
                ` : ''}
            </div>
            
            ${data.batchRun.status === 'running' ? `
                <div style="text-align: center; margin-top: 20px;">
                    <button class="btn btn-danger" onclick="stopBatchRun('${batchRunId}')">Stop Batch Run</button>
                </div>
            ` : ''}
        `;
        
        // Continue polling if still running
        if (data.batchRun.status === 'running' || data.batchRun.status === 'pending') {
            setTimeout(() => monitorBatchRun(batchRunId), 2000);
        } else {
            // Refresh project data when complete
            await openProject(currentProject.id);
        }
        
    } catch (error) {
        console.error('Error monitoring batch run:', error);
        content.innerHTML = '<p>Error monitoring batch run progress</p>';
    }
}

function monitorBatchRunWithSSE(batchRunId) {
    // First check if SSE is supported, fallback to polling if not
    if (typeof EventSource === 'undefined') {
        console.log('SSE not supported, falling back to polling');
        monitorBatchRunInline(batchRunId);
        return;
    }

    const liveProgress = document.getElementById('live-progress');
    let eventSource;
    
    try {
        // Start with polling to get initial state while SSE endpoint is being set up
        fetch(`${API_BASE}/projects/batch-runs/${batchRunId}/status`)
            .then(response => response.json())
            .then(data => {
                updateBatchProgressDisplay(data, batchRunId);
            })
            .catch(error => {
                console.error('Error getting initial batch status:', error);
                // Fall back to polling if SSE setup fails
                monitorBatchRun(batchRunId);
            });

        // Try to establish SSE connection for real-time updates
        eventSource = new EventSource(`${API_BASE}/projects/batch-runs/${batchRunId}/events`);
        
        eventSource.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);
                updateBatchProgressDisplay(data, batchRunId);
            } catch (error) {
                console.error('Error parsing SSE data:', error);
            }
        };

        eventSource.onerror = function(event) {
            console.error('SSE connection error:', event);
            eventSource.close();
            // Fall back to polling
            setTimeout(() => monitorBatchRun(batchRunId), 2000);
        };

        eventSource.addEventListener('batchCompleted', function(event) {
            eventSource.close();
            showNotification('Batch run completed!', 'success');
            setTimeout(() => {
                hideLiveProgress();
                openProject(currentProject.id); // Refresh project data
            }, 3000); // Show completion status for 3 seconds
        });

        eventSource.addEventListener('batchError', function(event) {
            eventSource.close();
            showNotification('Batch run encountered an error', 'error');
            hideLiveProgress();
        });

    } catch (error) {
        console.error('Error setting up SSE:', error);
        // Fall back to polling
        monitorBatchRun(batchRunId);
    }
}

function updateBatchProgressDisplay(data, batchRunId) {
    const liveProgress = document.getElementById('live-progress');
    
    const percentage = data.batchRun.totalTestCases > 0 ? 
        Math.round((data.batchRun.completedTestCases / data.batchRun.totalTestCases) * 100) : 0;
    
    liveProgress.innerHTML = `
        <div class="live-progress-header">
            <h3>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                Batch Test Run - ${data.batchRun.status}
            </h3>
            <button class="btn btn-secondary btn-sm" onclick="stopBatchRun()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <square x="6" y="6" width="12" height="12"/>
                </svg>
                Stop
            </button>
        </div>
        
        <div class="batch-progress-content">
            <div class="progress-section">
                <div class="progress-bar">
                    <div class="progress-bar-fill" style="width: ${percentage}%"></div>
                </div>
                <p class="progress-text">${data.batchRun.completedTestCases} / ${data.batchRun.totalTestCases} tests completed (${percentage}%)</p>
            </div>
            
            <div class="batch-stats">
                <div class="batch-stat">
                    <div class="stat-number">${data.batchRun.totalTestCases}</div>
                    <div class="stat-label">Total Tests</div>
                </div>
                <div class="batch-stat">
                    <div class="stat-number">${data.batchRun.completedTestCases}</div>
                    <div class="stat-label">Completed</div>
                </div>
                <div class="batch-stat">
                    <div class="stat-number">${data.batchRun.successRate || 0}%</div>
                    <div class="stat-label">Success Rate</div>
                </div>
                ${data.progress ? `
                    <div class="batch-stat">
                        <div class="stat-number">${data.progress.queueLength}</div>
                        <div class="stat-label">In Queue</div>
                    </div>
                ` : ''}
            </div>
            
            ${data.progress && data.progress.activeWorkers ? `
                <div class="worker-status">
                    <h4>Worker Status:</h4>
                    ${data.progress.activeWorkers.map(worker => `
                        <div class="worker-item working">
                            <strong>Worker ${worker.workerId}</strong><br>
                            Processing Goal: ${worker.goalId}
                        </div>
                    `).join('')}
                    ${Array.from({length: 3 - (data.progress.activeWorkers.length || 0)}, (_, i) => `
                        <div class="worker-item idle">
                            <strong>Worker ${(data.progress.activeWorkers.length || 0) + i + 1}</strong><br>
                            Idle
                        </div>
                    `).join('')}
                </div>
            ` : ''}
            
            ${data.batchRun.status === 'running' ? `
                <div style="text-align: center; margin-top: 20px;">
                    <button class="btn btn-danger" onclick="stopBatchRun('${batchRunId}')">Stop Batch Run</button>
                </div>
            ` : ''}
        </div>
    `;
}

function getProgressPercentage(batchRun) {
    if (batchRun.totalTestCases === 0) return 0;
    return Math.round((batchRun.completedTestCases / batchRun.totalTestCases) * 100);
}

async function stopBatchRun(batchRunId) {
    try {
        const response = await fetch(`${API_BASE}/projects/batch-runs/${batchRunId}/stop`, {
            method: 'POST'
        });
        
        if (response.ok) {
            showNotification('Batch run stopped', 'success');
        } else {
            showNotification('Failed to stop batch run', 'error');
        }
    } catch (error) {
        console.error('Error stopping batch run:', error);
        showNotification('Failed to stop batch run', 'error');
    }
}

async function toggleGoal(goalId, enabled) {
    try {
        const response = await fetch(`${API_BASE}/projects/${currentProject.id}/goals/${goalId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ enabled })
        });
        
        if (response.ok) {
            // Update local data
            const goal = currentProject.goals.find(g => g.id === goalId);
            if (goal) {
                goal.enabled = enabled;
            }
        } else {
            showNotification('Failed to update goal', 'error');
        }
    } catch (error) {
        console.error('Error updating goal:', error);
        showNotification('Failed to update goal', 'error');
    }
}

async function removeGoalFromProject(goalId) {
    if (!confirm('Are you sure you want to remove this goal from the project? The goal will remain available for other projects.')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/projects/${currentProject.id}/goals/${goalId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            // Refresh the project data
            await openProject(currentProject.id);
            showNotification('Goal removed from project successfully!', 'success');
        } else {
            const error = await response.json();
            showNotification(error.error || 'Failed to remove goal from project', 'error');
        }
    } catch (error) {
        console.error('Error removing goal from project:', error);
        showNotification('Failed to remove goal from project', 'error');
    }
}

function addGoalToProject() {
    if (!currentProject) return;
    
    // Show the modal for creating a new goal
    document.getElementById('add-goal-modal').style.display = 'block';
}


function closeAddGoalModal() {
    document.getElementById('add-goal-modal').style.display = 'none';
    document.getElementById('addGoalForm').reset();
    
    // Reset editing state
    delete document.getElementById('addGoalForm').dataset.editingGoalId;
    
    // Reset modal title and button text
    document.querySelector('#add-goal-modal h2').textContent = 'Create New Goal';
    document.querySelector('#addGoalForm button[type="submit"]').innerHTML = '✅ Create Goal';
}

async function handleAddGoalSubmit(event) {
    event.preventDefault();
    
    if (!currentProject) {
        showNotification('No project selected', 'error');
        return;
    }
    
    const formData = new FormData(event.target);
    const name = formData.get('name');
    const description = formData.get('description');
    const stepsText = formData.get('steps');
    const validationText = formData.get('validationCriteria');
    
    if (!name || !name.trim()) {
        showNotification('Goal name is required', 'error');
        return;
    }
    
    const steps = stepsText ? stepsText.split('\n').filter(s => s.trim()) : [];
    const validationCriteria = validationText ? validationText.split('\n').filter(s => s.trim()) : [];

    // Check if we're editing an existing goal
    const editingGoalId = event.target.dataset.editingGoalId;
    const isEditing = !!editingGoalId;

    try {
        let response;
        if (isEditing) {
            // Update existing goal
            response = await fetch(`${API_BASE}/projects/${currentProject.id}/goals/${editingGoalId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: name.trim(),
                    description: description ? description.trim() : '',
                    steps,
                    validationCriteria
                })
            });
        } else {
            // Create new goal
            response = await fetch(`${API_BASE}/projects/${currentProject.id}/goals`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: name.trim(),
                    description: description ? description.trim() : '',
                    steps,
                    validationCriteria
                })
            });
        }

        if (response.ok) {
            closeAddGoalModal();
            
            // Refresh the project data
            await openProject(currentProject.id);
            showNotification(isEditing ? 'Goal updated successfully!' : 'Goal created successfully!', 'success');
        } else {
            const error = await response.json();
            showNotification(error.error || `Failed to ${isEditing ? 'update' : 'create'} goal`, 'error');
        }
    } catch (error) {
        console.error(`Error ${isEditing ? 'updating' : 'creating'} goal:`, error);
        showNotification(`Failed to ${isEditing ? 'update' : 'create'} goal`, 'error');
    }
}

// Removed closeBatchMonitorModal - now using inline progress monitoring

// Edit functionality
function editGoal(goalId) {
    if (!currentProject || !currentProject.goals) return;
    
    const goal = currentProject.goals.find(g => g.id === goalId);
    if (!goal) {
        showNotification('Goal not found', 'error');
        return;
    }
    
    // Populate the goal form with existing data
    document.getElementById('newGoalName').value = goal.name;
    document.getElementById('newGoalDescription').value = goal.description || '';
    document.getElementById('newGoalSteps').value = goal.steps ? goal.steps.join('\n') : '';
    document.getElementById('newGoalValidation').value = goal.validationCriteria ? goal.validationCriteria.join('\n') : '';
    
    // Store the goal ID for updating
    document.getElementById('addGoalForm').dataset.editingGoalId = goalId;
    
    // Change the modal title and button text
    document.querySelector('#add-goal-modal h2').textContent = 'Edit Goal';
    document.querySelector('#addGoalForm button[type="submit"]').innerHTML = '✅ Update Goal';
    
    // Show the modal
    document.getElementById('add-goal-modal').style.display = 'block';
}

async function editProject(projectId) {
    try {
        // First load the project data
        const response = await fetch(`${API_BASE}/projects/${projectId}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch project: ${response.statusText}`);
        }
        const project = await response.json();
        
        // Populate the project form with project data
        const projectNameEl = document.getElementById('projectName');
        const projectDescEl = document.getElementById('projectDescription');
        const projectTagsEl = document.getElementById('projectTags');
        const miawOrgIdEl = document.getElementById('miawOrgId');
        const miawDeploymentNameEl = document.getElementById('miawDeploymentName');
        const miawBaseUrlEl = document.getElementById('miawBaseUrl');
        
        if (projectNameEl) projectNameEl.value = project.name || '';
        if (projectDescEl) projectDescEl.value = project.description || '';
        if (projectTagsEl) projectTagsEl.value = project.tags ? project.tags.join(', ') : '';
        if (miawOrgIdEl) miawOrgIdEl.value = project.miawOrgId || '';
        if (miawDeploymentNameEl) miawDeploymentNameEl.value = project.miawDeploymentName || '';
        if (miawBaseUrlEl) miawBaseUrlEl.value = project.miawBaseUrl || '';
        
        // Populate routing attributes
        if (project.miawRoutingAttributes) {
            try {
                const attributes = JSON.parse(project.miawRoutingAttributes);
                populateRoutingAttributes(JSON.stringify(attributes));
            } catch (e) {
                console.warn('Failed to parse routing attributes:', e);
            }
        }
        
        // Set form to edit mode
        const projectFormEl = document.getElementById('projectForm');
        if (projectFormEl) {
            projectFormEl.dataset.editingProjectId = projectId;
        }
        
        // Update form title
        const formTitle = document.querySelector('#project-form h3');
        if (formTitle) formTitle.textContent = 'Edit Project';
        
        // Show the modal backdrop and form
        let backdrop = document.getElementById('modal-backdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.id = 'modal-backdrop';
            backdrop.className = 'modal-backdrop';
            document.body.appendChild(backdrop);
        }
        backdrop.style.display = 'flex';
        
        // Show the form
        const formContainer = document.getElementById('project-form');
        if (formContainer) {
            formContainer.style.display = 'block';
        }
        
        // Focus on project name
        if (projectNameEl) {
            setTimeout(() => projectNameEl.focus(), 100);
        }
        
    } catch (error) {
        console.error('Error editing project:', error);
        showNotification('Failed to load project for editing', 'error');
    }
}

async function deleteProject(projectId) {
    // Find the project to get its name for the confirmation
    const project = projects.find(p => p.id === projectId);
    const projectName = project ? project.name : 'this project';
    
    if (!confirm(`Are you sure you want to delete "${projectName}"? This will also delete all goals, test sessions, and batch runs associated with this project. This action cannot be undone.`)) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/projects/${projectId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            throw new Error(`Failed to delete project: ${response.statusText}`);
        }
        
        // If we're currently viewing the deleted project, go back to projects list
        if (currentProject && currentProject.id === projectId) {
            backToProjects();
        }
        
        // Refresh the projects list
        await loadProjects();
        
        showNotification(`Project "${projectName}" deleted successfully`, 'success');
        
    } catch (error) {
        console.error('Error deleting project:', error);
        showNotification('Failed to delete project', 'error');
    }
}

function deleteCurrentProject() {
    if (!currentProject) {
        showNotification('No project selected', 'error');
        return;
    }
    
    // Use the existing deleteProject function
    deleteProject(currentProject.id);
}

function editCurrentProject() {
    console.log('editCurrentProject called, currentProject:', currentProject);
    
    if (!currentProject) {
        console.error('No current project selected');
        return;
    }
    
    try {
        // Populate the project form with existing data
        const projectNameEl = document.getElementById('projectName');
        const projectDescEl = document.getElementById('projectDescription');
        const projectTagsEl = document.getElementById('projectTags');
        const miawOrgIdEl = document.getElementById('miawOrgId');
        const miawDeploymentNameEl = document.getElementById('miawDeploymentName');
        const miawBaseUrlEl = document.getElementById('miawBaseUrl');
        
        console.log('Form elements found:', {
            projectName: !!projectNameEl,
            projectDesc: !!projectDescEl,
            projectTags: !!projectTagsEl,
            miawOrgId: !!miawOrgIdEl,
            miawDeploymentName: !!miawDeploymentNameEl,
            miawBaseUrl: !!miawBaseUrlEl
        });
        
        if (projectNameEl) projectNameEl.value = currentProject.name;
        if (projectDescEl) projectDescEl.value = currentProject.description || '';
        if (projectTagsEl) projectTagsEl.value = currentProject.tags ? currentProject.tags.join(', ') : '';
        if (miawOrgIdEl) miawOrgIdEl.value = currentProject.miawOrgId || '';
        if (miawDeploymentNameEl) miawDeploymentNameEl.value = currentProject.miawDeploymentName || '';
        if (miawBaseUrlEl) miawBaseUrlEl.value = currentProject.miawBaseUrl || '';
        
        // Populate routing attributes
        populateRoutingAttributes(currentProject.miawRoutingAttributes);
        
        // Store the project ID for updating
        const projectFormEl = document.getElementById('projectForm');
        if (projectFormEl) {
            projectFormEl.dataset.editingProjectId = currentProject.id;
            console.log('Set editing project ID:', currentProject.id);
        } else {
            console.error('projectForm element not found');
        }
        
        // Change the form title and button text
        const titleEl = document.querySelector('#project-form h3');
        const submitBtnEl = document.querySelector('#projectForm button[type="submit"]');
        
        if (titleEl) titleEl.textContent = 'Edit Project';
        if (submitBtnEl) submitBtnEl.innerHTML = '✅ Update Project';
        
        console.log('Form elements updated:', {
            title: !!titleEl,
            submitBtn: !!submitBtnEl
        });
        
        // Create backdrop first
        let backdrop = document.getElementById('modal-backdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.id = 'modal-backdrop';
            backdrop.style.position = 'fixed';
            backdrop.style.top = '0';
            backdrop.style.left = '0';
            backdrop.style.width = '100%';
            backdrop.style.height = '100%';
            backdrop.style.backgroundColor = 'rgba(0,0,0,0.5)';
            backdrop.style.zIndex = '9999';
            backdrop.style.display = 'flex';
            backdrop.style.alignItems = 'center';
            backdrop.style.justifyContent = 'center';
            backdrop.onclick = (e) => {
                if (e.target === backdrop) hideProjectForm();
            };
            document.body.appendChild(backdrop);
        }
        backdrop.style.display = 'flex';
        
        // Show the form inside the backdrop
        const formContainerEl = document.getElementById('project-form');
        if (formContainerEl) {
            // Move form to backdrop
            backdrop.appendChild(formContainerEl);
            
            formContainerEl.style.display = 'block';
            formContainerEl.style.position = 'relative';
            formContainerEl.style.backgroundColor = '#f8f9fa';
            formContainerEl.style.border = '1px solid #dee2e6';
            formContainerEl.style.boxShadow = '0 4px 20px rgba(0,0,0,0.3)';
            formContainerEl.style.maxWidth = '600px';
            formContainerEl.style.width = '90%';
            formContainerEl.style.maxHeight = '80vh';
            formContainerEl.style.overflowY = 'auto';
            formContainerEl.style.borderRadius = '8px';
            
            console.log('Form shown in backdrop');
            
            if (projectNameEl) projectNameEl.focus();
        } else {
            console.error('project-form container not found');
        }
    } catch (error) {
        console.error('Error in editCurrentProject:', error);
    }
}

async function testProjectMiawConnection() {
    if (!currentProject) {
        showNotification('No project selected', 'error');
        return;
    }
    
    try {
        // Show loading state
        const testButton = document.querySelector('button[onclick="testProjectMiawConnection()"]');
        const originalText = testButton.innerHTML;
        testButton.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="m9 12 2 2 4-4"/>
            </svg>
            Testing...
        `;
        testButton.disabled = true;
        
        const response = await fetch(`${API_BASE}/projects/${currentProject.id}/test-miaw-connection`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification(
                `MIAW connection successful! Response time: ${result.responseTime}ms`, 
                'success'
            );
        } else {
            showNotification(
                `MIAW connection failed: ${result.details}`, 
                'error'
            );
        }
        
        // Reset button
        testButton.innerHTML = originalText;
        testButton.disabled = false;
        
    } catch (error) {
        console.error('Error testing MIAW connection:', error);
        showNotification('Failed to test MIAW connection', 'error');
        
        // Reset button
        const testButton = document.querySelector('button[onclick="testProjectMiawConnection()"]');
        testButton.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            Test MIAW Connection
        `;
        testButton.disabled = false;
    }
}

// Notification system
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 8px;
        color: white;
        font-weight: 500;
        z-index: 10000;
        animation: slideIn 0.3s ease;
        max-width: 400px;
    `;
    
    switch (type) {
        case 'success':
            notification.style.background = '#48bb78';
            break;
        case 'error':
            notification.style.background = '#f56565';
            break;
        case 'warning':
            notification.style.background = '#ed8936';
            break;
        default:
            notification.style.background = '#667eea';
    }
    
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            if (notification.parentNode) {
                document.body.removeChild(notification);
            }
        }, 300);
    }, 4000);
}

window.onclick = function(event) {
    const testModal = document.getElementById('test-modal');
    const addGoalModal = document.getElementById('add-goal-modal');
    
    if (event.target === testModal) {
        closeTestModal();
    } else if (event.target === addGoalModal) {
        closeAddGoalModal();
    }
}

const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);

// Admin Tab Functions
let systemLogs = [];
let currentLogLevel = 'all';

async function refreshSystemStatus() {
    try {
        // Update system status indicator
        const statusIndicator = document.getElementById('system-status-indicator');
        statusIndicator.innerHTML = `
            <span class="status-dot status-success"></span>
            <span class="status-text">System Online</span>
        `;

        // Fetch and update system metrics
        await Promise.all([
            updateProjectMetrics(),
            updateSystemMetrics(),
            refreshLogs()
        ]);

        showNotification('System status refreshed', 'success');
    } catch (error) {
        console.error('Error refreshing system status:', error);
        const statusIndicator = document.getElementById('system-status-indicator');
        statusIndicator.innerHTML = `
            <span class="status-dot status-error"></span>
            <span class="status-text">System Error</span>
        `;
        showNotification('Failed to refresh system status', 'error');
    }
}

async function updateProjectMetrics() {
    try {
        const response = await fetch(`${API_BASE}/projects`);
        const projectsData = await response.json();
        
        // Count total projects
        document.getElementById('total-projects').textContent = projectsData.length;
        
        // Count total goals across all projects
        let totalGoals = 0;
        for (const project of projectsData) {
            if (project.goals) {
                totalGoals += project.goals.length;
            }
        }
        document.getElementById('total-goals').textContent = totalGoals;
        
    } catch (error) {
        console.error('Error updating project metrics:', error);
    }
}

async function updateSystemMetrics() {
    try {
        // Update active sessions (simulate for now)
        const activeSessions = activeBatchRun ? 1 : 0;
        document.getElementById('active-sessions').textContent = activeSessions;
        
        // Get total test sessions count
        const response = await fetch(`${API_BASE}/test-sessions`);
        if (response.ok) {
            const testSessions = await response.json();
            document.getElementById('total-tests').textContent = testSessions.length;
        }
    } catch (error) {
        console.error('Error updating system metrics:', error);
        // Set fallback values
        document.getElementById('total-tests').textContent = '0';
    }
}

async function refreshLogs() {
    try {
        // Simulate fetching debug logs (in a real implementation, this would fetch from server)
        const mockLogs = [
            {
                timestamp: new Date().toISOString(),
                level: 'info',
                message: 'System status check completed successfully'
            },
            {
                timestamp: new Date(Date.now() - 60000).toISOString(),
                level: 'debug',
                message: 'Database connection pool status: 5/10 connections active'
            },
            {
                timestamp: new Date(Date.now() - 120000).toISOString(),
                level: 'info',
                message: 'Batch test executor initialized with 3 workers'
            },
            {
                timestamp: new Date(Date.now() - 180000).toISOString(),
                level: 'warn',
                message: 'OpenAI API rate limit approaching (80% of quota used)'
            },
            {
                timestamp: new Date(Date.now() - 300000).toISOString(),
                level: 'error',
                message: 'Failed to connect to Salesforce API endpoint (timeout after 30s)'
            }
        ];

        systemLogs = mockLogs;
        updateLogsDisplay();
        
    } catch (error) {
        console.error('Error refreshing logs:', error);
        showNotification('Failed to refresh logs', 'error');
    }
}

function updateLogsDisplay() {
    const logsContainer = document.getElementById('debug-logs');
    const filteredLogs = currentLogLevel === 'all' 
        ? systemLogs 
        : systemLogs.filter(log => log.level === currentLogLevel);

    if (filteredLogs.length === 0) {
        logsContainer.innerHTML = `
            <div class="log-placeholder">
                <div class="placeholder-icon">📋</div>
                <p>No logs available for level: ${currentLogLevel}</p>
                <p class="placeholder-hint">Try changing the log level filter or refresh logs</p>
            </div>
        `;
        return;
    }

    logsContainer.innerHTML = filteredLogs.map(log => `
        <div class="log-entry ${log.level}">
            <span class="log-timestamp">${new Date(log.timestamp).toLocaleTimeString()}</span>
            <span class="log-level ${log.level}">${log.level.toUpperCase()}</span>
            <span class="log-message">${escapeHtml(log.message)}</span>
        </div>
    `).join('');
}

function clearLogs() {
    if (confirm('Are you sure you want to clear all logs?')) {
        systemLogs = [];
        updateLogsDisplay();
        showNotification('Logs cleared', 'info');
    }
}

// Log level filter change handler
document.addEventListener('DOMContentLoaded', function() {
    const logLevelFilter = document.getElementById('log-level-filter');
    if (logLevelFilter) {
        logLevelFilter.addEventListener('change', function(event) {
            currentLogLevel = event.target.value;
            updateLogsDisplay();
        });
    }
});

// Auto-refresh system status every 30 seconds when on admin tab
let adminRefreshInterval = null;

function startAdminAutoRefresh() {
    if (adminRefreshInterval) {
        clearInterval(adminRefreshInterval);
    }
    
    adminRefreshInterval = setInterval(() => {
        if (document.getElementById('admin-tab').classList.contains('active')) {
            refreshSystemStatus();
        }
    }, 30000); // 30 seconds
}

function stopAdminAutoRefresh() {
    if (adminRefreshInterval) {
        clearInterval(adminRefreshInterval);
        adminRefreshInterval = null;
    }
}

// Tab initialization is now handled in the main showTab function above

// Conversation Import Functions
let currentProcessingJob = null;
let selectedGoals = new Set();
let isMonitoringProgress = false;

function initializeConversationImport() {
    // Load projects for the dropdown
    loadProjectsForImport();
    
    // Set up file upload handlers
    setupFileUploadHandlers();
    
    // Reset any previous state
    resetImportState();
}

async function loadProjectsForImport() {
    try {
        const response = await fetch(`${API_BASE}/projects`);
        const projects = await response.json();
        
        const select = document.getElementById('target-project');
        select.innerHTML = '<option value="">Select a project for generated goals</option>';
        
        projects.forEach(project => {
            const option = document.createElement('option');
            option.value = project.id;
            option.textContent = `${project.name} (${project.goalCount || 0} goals)`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading projects:', error);
        showNotification('Failed to load projects', 'error');
    }
}

function setupFileUploadHandlers() {
    const uploadZone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('csv-file-input');
    
    // Drag and drop handlers
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });
    
    uploadZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
    });
    
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFileSelection(files[0]);
        }
    });
    
    // File input handler
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelection(e.target.files[0]);
        }
    });
    
    // Click handler for upload zone
    uploadZone.addEventListener('click', () => {
        fileInput.click();
    });
}

function handleFileSelection(file) {
    // Validate file
    if (!file.name.endsWith('.csv')) {
        showNotification('Please select a CSV file', 'error');
        return;
    }
    
    if (file.size > 50 * 1024 * 1024) { // 50MB limit
        showNotification('File size must be less than 50MB', 'error');
        return;
    }
    
    // Show file info and start upload
    showNotification(`Selected file: ${file.name} (${formatFileSize(file.size)})`, 'info');
    uploadCSVFile(file);
}

async function uploadCSVFile(file) {
    try {
        // Show processing section
        document.getElementById('processing-section').style.display = 'block';
        document.getElementById('results-section').style.display = 'none';
        
        // Reset progress
        updateProcessingProgress(0, 'Uploading file...');
        
        const formData = new FormData();
        formData.append('csvFile', file);
        formData.append('generateGoals', document.getElementById('generate-goals').checked);
        formData.append('batchSize', document.getElementById('batch-size').value);
        formData.append('projectId', document.getElementById('target-project').value);
        
        const response = await fetch(`${API_BASE}/conversations/upload`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Upload failed');
        }
        
        const result = await response.json();
        currentProcessingJob = result.jobId;
        
        showNotification(`Upload successful! Processing ${result.summary.validConversations} conversations...`, 'success');
        
        // Show parse errors if any
        if (result.parseErrors && result.parseErrors.length > 0) {
            console.warn('Parse errors:', result.parseErrors);
            showNotification(`${result.parseErrors.length} rows had parsing errors`, 'warning');
        }
        
        // Start monitoring progress
        monitorProcessingProgress();
        
    } catch (error) {
        console.error('Upload error:', error);
        showNotification(`Upload failed: ${error.message}`, 'error');
        document.getElementById('processing-section').style.display = 'none';
    }
}

async function monitorProcessingProgress() {
    if (!currentProcessingJob || isMonitoringProgress) return;
    
    isMonitoringProgress = true;
    
    try {
        const response = await fetch(`${API_BASE}/conversations/jobs/${currentProcessingJob}/status`);
        const status = await response.json();
        
        if (status.error) {
            throw new Error(status.error);
        }
        
        // Update progress display
        updateProcessingProgress(status.progress, getProgressText(status));
        updateProcessingStats(status);
        
        if (status.status === 'completed') {
            showNotification('Processing completed!', 'success');
            isMonitoringProgress = false;
            loadProcessingResults();
        } else if (status.status === 'failed') {
            isMonitoringProgress = false;
            throw new Error('Processing failed');
        } else {
            // Continue monitoring
            isMonitoringProgress = false;
            setTimeout(monitorProcessingProgress, 2000);
        }
        
    } catch (error) {
        isMonitoringProgress = false;
        console.error('Monitoring error:', error);
        showNotification(`Processing error: ${error.message}`, 'error');
    }
}

function updateProcessingProgress(progress, text) {
    document.getElementById('processing-progress').style.width = `${progress}%`;
    document.getElementById('processing-text').textContent = text;
}

function getProgressText(status) {
    if (status.status === 'analyzing') {
        return `Analyzing conversations... ${status.processedCount}/${status.totalConversations}`;
    } else if (status.status === 'completed') {
        return 'Processing completed!';
    } else {
        return status.status;
    }
}

function updateProcessingStats(status) {
    document.getElementById('processed-count').textContent = status.processedCount || 0;
    document.getElementById('error-count').textContent = status.errorCount || 0;
    
    // We'll update generated goals count when we load results
}

async function loadProcessingResults() {
    try {
        const response = await fetch(`${API_BASE}/conversations/jobs/${currentProcessingJob}/results?details=true`);
        const results = await response.json();
        
        if (results.error) {
            throw new Error(results.error);
        }
        
        // Update stats
        document.getElementById('generated-goals').textContent = results.generatedGoals.length;
        
        // Show results section
        document.getElementById('results-section').style.display = 'block';
        
        // Load results into UI
        displayResultsSummary(results);
        displayGeneratedGoals(results.generatedGoals);
        
        // Load analytics
        loadAnalytics();
        
        // Load errors if any
        displayErrors(results.errors || []);
        
    } catch (error) {
        console.error('Error loading results:', error);
        showNotification(`Failed to load results: ${error.message}`, 'error');
    }
}

function displayResultsSummary(results) {
    const summary = results.summary;
    const summaryHtml = `
        <h4>Processing Summary</h4>
        <div class="summary-stats">
            <div class="summary-stat">
                <span class="stat-number">${summary.totalProcessed}</span>
                <span class="stat-label">Total Processed</span>
            </div>
            <div class="summary-stat">
                <span class="stat-number">${summary.successfulGoals}</span>
                <span class="stat-label">Goals Generated</span>
            </div>
            <div class="summary-stat">
                <span class="stat-number">${Math.round(summary.successRate)}%</span>
                <span class="stat-label">Success Rate</span>
            </div>
            <div class="summary-stat">
                <span class="stat-number">${summary.processingTime || 'N/A'}</span>
                <span class="stat-label">Processing Time</span>
            </div>
        </div>
    `;
    
    document.getElementById('results-summary').innerHTML = summaryHtml;
}

function displayGeneratedGoals(goals) {
    const container = document.getElementById('generated-goals-list');
    
    if (!goals || goals.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>No goals were generated from the conversations.</p>
            </div>
        `;
        return;
    }
    
    const goalsHtml = goals.map(goal => {
        const qualityClass = getQualityClass(goal.qualityScore?.overall || 0);
        return `
            <div class="generated-goal-card" data-goal-id="${goal.sourceConversationId}">
                <div class="goal-card-checkbox">
                    <input type="checkbox" class="goal-checkbox" 
                           data-goal-id="${goal.sourceConversationId}"
                           onchange="toggleGoalSelection('${goal.sourceConversationId}', this.checked)">
                </div>
                
                <div class="goal-card-header">
                    <h4 class="goal-card-title">${escapeHtml(goal.name)}</h4>
                </div>
                
                <div class="goal-card-category">${goal.category || 'General'}</div>
                
                <p class="goal-card-description">${escapeHtml(goal.description)}</p>
                
                <div class="goal-details">
                    <div class="goal-steps">
                        <strong>Test Steps:</strong>
                        <ul>
                            ${(goal.steps || []).slice(0, 3).map(step => `<li>${escapeHtml(step)}</li>`).join('')}
                            ${goal.steps && goal.steps.length > 3 ? `<li><em>+${goal.steps.length - 3} more steps...</em></li>` : ''}
                        </ul>
                    </div>
                    
                    <div class="goal-validation">
                        <strong>Validation Criteria:</strong>
                        <ul>
                            ${(goal.validationCriteria || []).slice(0, 2).map(criteria => `<li>${escapeHtml(criteria)}</li>`).join('')}
                            ${goal.validationCriteria && goal.validationCriteria.length > 2 ? `<li><em>+${goal.validationCriteria.length - 2} more criteria...</em></li>` : ''}
                        </ul>
                    </div>
                </div>
                
                <div class="goal-card-metrics">
                    <span>Complexity: ${goal.complexity || 'Medium'}</span>
                    <span class="quality-score ${qualityClass}">
                        Quality: ${Math.round((goal.qualityScore?.overall || 0) * 100)}%
                    </span>
                </div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = goalsHtml;
}

function getQualityClass(score) {
    if (score >= 0.8) return 'high';
    if (score >= 0.6) return 'medium';
    return 'low';
}

function toggleGoalSelection(goalId, selected) {
    if (selected) {
        selectedGoals.add(goalId);
    } else {
        selectedGoals.delete(goalId);
    }
    
    // Update card appearance
    const card = document.querySelector(`[data-goal-id="${goalId}"]`);
    if (card) {
        card.classList.toggle('selected', selected);
    }
}

function selectAllGoals() {
    const checkboxes = document.querySelectorAll('.goal-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = true;
        toggleGoalSelection(checkbox.dataset.goalId, true);
    });
}

function selectNoneGoals() {
    const checkboxes = document.querySelectorAll('.goal-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
        toggleGoalSelection(checkbox.dataset.goalId, false);
    });
    selectedGoals.clear();
}

async function importSelectedGoals() {
    const projectId = document.getElementById('target-project').value;
    
    if (!projectId) {
        showNotification('Please select a target project', 'error');
        return;
    }
    
    if (selectedGoals.size === 0) {
        showNotification('Please select at least one goal to import', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/conversations/jobs/${currentProcessingJob}/import`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                projectId,
                selectedGoalIds: Array.from(selectedGoals),
                options: {
                    checkDuplicates: true
                }
            })
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Import failed');
        }
        
        showNotification(
            `Successfully imported ${result.summary.imported} goals! ` +
            (result.summary.duplicates > 0 ? `${result.summary.duplicates} duplicates skipped.` : ''),
            'success'
        );
        
        // Show detailed results
        if (result.summary.failed > 0) {
            showNotification(`${result.summary.failed} goals failed to import`, 'warning');
        }
        
        // Reset selection
        selectNoneGoals();
        
    } catch (error) {
        console.error('Import error:', error);
        showNotification(`Import failed: ${error.message}`, 'error');
    }
}

async function loadAnalytics() {
    try {
        const response = await fetch(`${API_BASE}/conversations/jobs/${currentProcessingJob}/analytics`);
        const analytics = await response.json();
        
        if (analytics.error) {
            throw new Error(analytics.error);
        }
        
        displayAnalytics(analytics);
        
    } catch (error) {
        console.error('Error loading analytics:', error);
        document.getElementById('conversation-analytics').innerHTML = `
            <div class="error-item">
                <div class="error-title">Analytics Error</div>
                <div class="error-message">Failed to load analytics: ${error.message}</div>
            </div>
        `;
    }
}

function displayAnalytics(analytics) {
    const analyticsHtml = `
        <div class="analytics-grid">
            <div class="analytics-card">
                <h4>Conversation Categories</h4>
                <div class="analytics-chart">
                    ${formatCategoryDistribution(analytics.categoryDistribution)}
                </div>
            </div>
            
            <div class="analytics-card">
                <h4>Complexity Distribution</h4>
                <div class="analytics-chart">
                    ${formatComplexityDistribution(analytics.complexityDistribution)}
                </div>
            </div>
            
            <div class="analytics-card">
                <h4>Conversation Patterns</h4>
                <div class="analytics-chart">
                    ${formatPatternDistribution(analytics.patternDistribution)}
                </div>
            </div>
            
            <div class="analytics-card">
                <h4>Processing Metrics</h4>
                <div class="metrics-list">
                    <div class="metric-item">
                        <span class="metric-label">Average Complexity:</span>
                        <span class="metric-value">${Math.round(analytics.averageComplexity)}/100</span>
                    </div>
                    <div class="metric-item">
                        <span class="metric-label">Total Conversations:</span>
                        <span class="metric-value">${analytics.totalConversations}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.getElementById('conversation-analytics').innerHTML = analyticsHtml;
}

function formatCategoryDistribution(distribution) {
    const items = Object.entries(distribution)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .map(([category, count]) => `<div>${category}: ${count}</div>`)
        .join('');
    
    return items || '<div>No category data available</div>';
}

function formatComplexityDistribution(distribution) {
    return `
        <div>Low: ${distribution.Low || 0}</div>
        <div>Medium: ${distribution.Medium || 0}</div>
        <div>High: ${distribution.High || 0}</div>
    `;
}

function formatPatternDistribution(distribution) {
    const items = Object.entries(distribution)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3)
        .map(([pattern, count]) => `<div>${pattern.replace(/_/g, ' ')}: ${count}</div>`)
        .join('');
    
    return items || '<div>No pattern data available</div>';
}

function displayErrors(errors) {
    const container = document.getElementById('processing-errors');
    
    if (!errors || errors.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>No errors occurred during processing.</p>
            </div>
        `;
        return;
    }
    
    const errorsHtml = `
        <div class="error-list">
            ${errors.map(error => `
                <div class="error-item">
                    <div class="error-title">
                        ${error.conversationId ? `Conversation: ${error.conversationId}` : 'Processing Error'}
                    </div>
                    <div class="error-message">${escapeHtml(error.error)}</div>
                </div>
            `).join('')}
        </div>
    `;
    
    container.innerHTML = errorsHtml;
}

function showResultsTab(tabName) {
    // Hide all tab contents
    document.querySelectorAll('.results-tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Remove active class from all buttons
    document.querySelectorAll('.results-tabs .tab-button').forEach(button => {
        button.classList.remove('active');
    });
    
    // Show selected tab
    document.getElementById(`${tabName}-results`).classList.add('active');
    
    // Set active button
    event.target.classList.add('active');
}

function resetImportState() {
    currentProcessingJob = null;
    selectedGoals.clear();
    
    // Hide processing and results sections
    document.getElementById('processing-section').style.display = 'none';
    document.getElementById('results-section').style.display = 'none';
    
    // Reset file input
    document.getElementById('csv-file-input').value = '';
    
    // Reset upload zone
    document.getElementById('upload-zone').classList.remove('dragover');
}

// Routing Attributes Management
function addRoutingAttribute() {
    const container = document.getElementById('routingAttributesContainer');
    const newRow = document.createElement('div');
    newRow.className = 'routing-attribute-row';
    newRow.innerHTML = `
        <input type="text" placeholder="Field name (e.g., _firstName)" class="routing-key">
        <input type="text" placeholder="Value (e.g., john)" class="routing-value">
        <button type="button" class="btn btn-small btn-danger" onclick="removeRoutingAttribute(this)">Remove</button>
    `;
    container.appendChild(newRow);
}

function removeRoutingAttribute(button) {
    const container = document.getElementById('routingAttributesContainer');
    if (container.children.length > 1) {
        button.parentElement.remove();
    }
}

function collectRoutingAttributes() {
    const container = document.getElementById('routingAttributesContainer');
    const rows = container.querySelectorAll('.routing-attribute-row');
    const attributes = {};
    
    rows.forEach(row => {
        const key = row.querySelector('.routing-key').value.trim();
        const value = row.querySelector('.routing-value').value.trim();
        if (key && value) {
            attributes[key] = value;
        }
    });
    
    return Object.keys(attributes).length > 0 ? JSON.stringify(attributes) : '';
}

function populateRoutingAttributes(attributesJson) {
    const container = document.getElementById('routingAttributesContainer');
    container.innerHTML = ''; // Clear existing rows
    
    if (attributesJson) {
        try {
            const attributes = JSON.parse(attributesJson);
            Object.entries(attributes).forEach(([key, value]) => {
                const newRow = document.createElement('div');
                newRow.className = 'routing-attribute-row';
                newRow.innerHTML = `
                    <input type="text" placeholder="Field name (e.g., _firstName)" class="routing-key" value="${key}">
                    <input type="text" placeholder="Value (e.g., john)" class="routing-value" value="${value}">
                    <button type="button" class="btn btn-small btn-danger" onclick="removeRoutingAttribute(this)">Remove</button>
                `;
                container.appendChild(newRow);
            });
        } catch (e) {
            console.error('Error parsing routing attributes:', e);
        }
    }
    
    // Ensure at least one empty row exists
    if (container.children.length === 0) {
        addRoutingAttribute();
    }
}

// Batch run accordion toggle functions
async function toggleBatchRunDetails(batchRunId) {
    const detailsSection = document.getElementById(`batch-details-${batchRunId}`);
    const toggleText = document.getElementById(`toggle-text-${batchRunId}`);
    const toggleIcon = document.getElementById(`toggle-icon-${batchRunId}`);
    
    if (!detailsSection) return;
    
    // Toggle visibility
    if (detailsSection.style.display === 'none') {
        // Expand
        detailsSection.style.display = 'block';
        toggleText.textContent = 'Hide Results';
        toggleIcon.textContent = '▲';
        
        // Load test sessions if not already loaded
        if (!detailsSection.dataset.loaded) {
            await loadBatchRunTestSessions(batchRunId);
            detailsSection.dataset.loaded = 'true';
        }
    } else {
        // Collapse
        detailsSection.style.display = 'none';
        toggleText.textContent = 'View Results';
        toggleIcon.textContent = '▼';
    }
}

async function loadBatchRunTestSessions(batchRunId) {
    try {
        const response = await fetch(`${API_BASE}/projects/batch-runs/${batchRunId}/results`);
        if (!response.ok) throw new Error('Failed to load batch run results');
        
        const results = await response.json();
        const detailsSection = document.getElementById(`batch-details-${batchRunId}`);
        const loadingSpinner = document.getElementById(`loading-${batchRunId}`);
        
        if (loadingSpinner) {
            loadingSpinner.style.display = 'none';
        }
        
        // Create test sessions content
        detailsSection.innerHTML = `
            <div class="batch-details-content">
                <div class="batch-summary-stats">
                    <div class="summary-stat-inline">
                        <span class="stat-label">Total:</span>
                        <span class="stat-value">${results.summary.totalTests}</span>
                    </div>
                    <div class="summary-stat-inline">
                        <span class="stat-label">Completed:</span>
                        <span class="stat-value">${results.summary.completedTests}</span>
                    </div>
                    <div class="summary-stat-inline">
                        <span class="stat-label">Success Rate:</span>
                        <span class="stat-value">${Math.round(results.summary.successRate)}%</span>
                    </div>
                    <div class="summary-stat-inline">
                        <span class="stat-label">Avg Score:</span>
                        <span class="stat-value">${results.summary.averageScore}%</span>
                    </div>
                </div>
                
                <div class="test-sessions-grid">
                    ${results.testSessions.map(session => `
                        <div class="test-session-card" onclick="showTestSessionDetails('${session.id}')">
                            <div class="session-card-header">
                                <h6>${escapeHtml(session.goalName || 'Unknown Goal')}</h6>
                                <div class="session-card-status">
                                    <span class="status-badge-small status-${session.status}">${session.status}</span>
                                    ${session.score !== null ? `<span class="score-badge-small">${Math.round(session.score)}%</span>` : ''}
                                </div>
                            </div>
                            <p class="session-description">${escapeHtml((session.goalDescription || '').substring(0, 100))}${(session.goalDescription || '').length > 100 ? '...' : ''}</p>
                            <div class="session-timestamp">
                                ${session.startedAt ? new Date(session.startedAt).toLocaleString() : 'No timestamp'}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Error loading batch run test sessions:', error);
        const detailsSection = document.getElementById(`batch-details-${batchRunId}`);
        if (detailsSection) {
            detailsSection.innerHTML = `
                <div class="error-message">
                    Failed to load test sessions. Please try again.
                </div>
            `;
        }
    }
}

// Individual test session details modal
async function showTestSessionDetails(sessionId) {
    try {
        const response = await fetch(`${API_BASE}/tests/${sessionId}`);
        if (!response.ok) throw new Error('Failed to load test session details');
        
        const session = await response.json();
        
        // Use the existing test modal infrastructure
        const modal = document.getElementById('test-modal');
        const details = document.getElementById('test-details');
        
        details.innerHTML = `
            <h3>${escapeHtml(session.goalName || 'Test Session')}</h3>
            <p><strong>Status:</strong> <span class="test-status status-${session.status}">${session.status}</span></p>
            <p><strong>Score:</strong> ${session.score !== null ? Math.round(session.score) + '%' : 'Not available'}</p>
            
            ${session.conversationLog && session.conversationLog.length > 0 ? `
                <h4>💬 Conversation Log:</h4>
                <div class="conversation-log">
                    ${session.conversationLog.map((msg, index) => `
                        <div class="message ${msg.sender === 'TestingAgent' ? 'user-message' : 'agent-message'}">
                            <div class="message-avatar">
                                ${msg.sender === 'TestingAgent' ? 
                                    '<div class="avatar testing-agent">🤖</div>' : 
                                    '<div class="avatar agentforce">⚡</div>'
                                }
                            </div>
                            <div class="message-content">
                                <div class="message-header">
                                    <span class="sender-name">
                                        ${msg.sender === 'TestingAgent' ? 'Testing Agent' : 'Agentforce'}
                                    </span>
                                    ${msg.timestamp ? `<span class="timestamp">${new Date(msg.timestamp).toLocaleTimeString()}</span>` : ''}
                                </div>
                                <div class="message-text">${escapeHtml(msg.message || '')}</div>
                                ${msg.intent ? `<div class="message-intent">Intent: ${escapeHtml(msg.intent)}</div>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : '<p>No conversation log available.</p>'}
            
            ${session.validationResults ? `
                <h4>📋 Validation Results:</h4>
                <div class="validation-results">
                    ${session.validationResults.goalAchieved !== undefined ? 
                        `<p><strong>Goal Achieved:</strong> ${session.validationResults.goalAchieved ? '✅ Yes' : '❌ No'}</p>` : ''
                    }
                    ${session.validationResults.summary ? 
                        `<p><strong>Summary:</strong> ${escapeHtml(session.validationResults.summary)}</p>` : ''
                    }
                    ${session.validationResults.completedActions && session.validationResults.completedActions.length > 0 ? `
                        <p><strong>Completed Actions:</strong></p>
                        <ul>${session.validationResults.completedActions.map(action => `<li>${escapeHtml(action)}</li>`).join('')}</ul>
                    ` : ''}
                    ${session.validationResults.issues && session.validationResults.issues.length > 0 ? `
                        <p><strong>Issues:</strong></p>
                        <ul>${session.validationResults.issues.map(issue => `<li>${escapeHtml(issue)}</li>`).join('')}</ul>
                    ` : ''}
                </div>
            ` : ''}
        `;
        
        modal.style.display = 'block';
    } catch (error) {
        console.error('Error loading test session details:', error);
        showNotification('Failed to load test session details', 'error');
    }
}

async function deleteBatchRun(batchRunId) {
    if (!confirm('Are you sure you want to delete this batch run? This action cannot be undone.')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/projects/batch-runs/${batchRunId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) throw new Error('Failed to delete batch run');
        
        showNotification('Batch run deleted successfully', 'success');
        
        // Refresh the batch runs list
        if (currentProject) {
            await loadProjectBatchRuns();
        }
    } catch (error) {
        console.error('Error deleting batch run:', error);
        showNotification('Failed to delete batch run', 'error');
    }
}

// Generic modal functions
function showModal(content) {
    const modal = document.getElementById('generic-modal');
    const modalBody = document.getElementById('generic-modal-body');
    
    if (modal && modalBody) {
        modalBody.innerHTML = content;
        modal.style.display = 'block';
    } else {
        console.error('Generic modal not found in DOM');
    }
}

function closeModal() {
    const modal = document.getElementById('generic-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// CSV Export function for batch runs
async function exportBatchRunCSV(batchRunId, batchRunName) {
    try {
        showNotification('Preparing CSV export...', 'info');
        
        const response = await fetch(`${API_BASE}/projects/batch-runs/${batchRunId}/export`);
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Export failed');
        }
        
        // Get the CSV content as blob
        const blob = await response.blob();
        
        // Create download link
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `batch-run-export-${(batchRunName || 'unnamed').replace(/[^a-z0-9]/gi, '_')}-${new Date().toISOString().split('T')[0]}.csv`;
        
        // Trigger download
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Clean up
        window.URL.revokeObjectURL(url);
        
        showNotification('CSV export completed successfully!', 'success');
        
    } catch (error) {
        console.error('Error exporting batch run CSV:', error);
        showNotification(`Export failed: ${error.message}`, 'error');
    }
}

// Project Subtabs Functions
function showProjectSubtab(subtabName) {
    // Hide all subtab contents
    const allSubtabs = document.querySelectorAll('.project-subtab-content');
    allSubtabs.forEach(subtab => {
        subtab.classList.remove('active');
    });
    
    // Remove active class from all buttons
    const allButtons = document.querySelectorAll('.project-subtab-button');
    allButtons.forEach(button => {
        button.classList.remove('active');
    });
    
    // Show selected subtab content
    const selectedSubtab = document.getElementById(`project-subtab-${subtabName}`);
    if (selectedSubtab) {
        selectedSubtab.classList.add('active');
    }
    
    // Activate selected button
    const selectedButton = document.querySelector(`[onclick="showProjectSubtab('${subtabName}')"]`);
    if (selectedButton) {
        selectedButton.classList.add('active');
    }
    
    // Load project settings when switching to settings tab
    if (subtabName === 'settings' && currentProject) {
        loadProjectSettings();
    }
    
    // Initialize project import when switching to import tab
    if (subtabName === 'import' && currentProject) {
        initializeProjectImport();
    }
}

// Project Settings Functions
async function loadProjectSettings() {
    if (!currentProject) return;
    
    try {
        const response = await fetch(`${API_BASE}/projects/${currentProject.id}`);
        const project = await response.json();
        
        // Populate the goal generation prompt field
        const promptTextarea = document.getElementById('project-goal-prompt');
        if (promptTextarea) {
            promptTextarea.value = project.goalGenerationPrompt || '';
        }
    } catch (error) {
        console.error('Error loading project settings:', error);
        showNotification('Error loading project settings: ' + error.message, 'error');
    }
}

async function saveProjectSettings() {
    if (!currentProject) return;
    
    try {
        const promptTextarea = document.getElementById('project-goal-prompt');
        const goalGenerationPrompt = promptTextarea ? promptTextarea.value.trim() : '';
        
        const response = await fetch(`${API_BASE}/projects/${currentProject.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                goalGenerationPrompt: goalGenerationPrompt || null
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to save settings');
        }
        
        const updatedProject = await response.json();
        currentProject.goalGenerationPrompt = updatedProject.goalGenerationPrompt;
        
        showNotification('Project settings saved successfully!', 'success');
    } catch (error) {
        console.error('Error saving project settings:', error);
        showNotification('Error saving project settings: ' + error.message, 'error');
    }
}

// Load default prompt into the textarea
function loadDefaultPrompt() {
    const textarea = document.getElementById('project-goal-prompt');
    if (textarea) {
        textarea.value = getDefaultGoalPrompt();
        showNotification('Default prompt loaded', 'info');
    }
}

// Get default goal generation prompt
function getDefaultGoalPrompt() {
    return `Convert this human customer service conversation into a test goal for an AI agent.

CONVERSATION ANALYSIS:
- Primary Intent: {analysis.intentAnalysis.primaryIntent}
- Category: {analysis.category}
- Complexity: {analysis.complexity.level} ({analysis.complexity.score}/100)
- Resolution: {analysis.resolution}
- Emotional Tone: {analysis.emotionalTone.overall}
- Pattern: {analysis.conversationPattern.primary}

ORIGINAL CONVERSATION:
{conversation.conversation_data}

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
    "category": "{analysis.category}",
    "complexity": "{analysis.complexity.level}",
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
        "originalResolution": "{analysis.resolution}",
        "emotionalComplexity": "{analysis.emotionalTone.overall}",
        "conversationSummary": "{analysis.summary || ''}"
    }
}`;
}

// Project Import Functions
let projectCurrentProcessingJob = null;
let isPollingProjectProgress = false;
let projectSelectedGoals = new Set();

function initializeProjectImport() {
    // Set up file upload handlers for project import
    setupProjectFileUploadHandlers();
    
    // Reset any previous state
    resetProjectImportState();
}

function setupProjectFileUploadHandlers() {
    const uploadZone = document.getElementById('project-upload-zone');
    const fileInput = document.getElementById('project-csv-file');
    
    if (!uploadZone || !fileInput) return;
    
    // File input change handler
    fileInput.onchange = function(e) {
        const file = e.target.files[0];
        if (file) {
            handleProjectFileUpload(file);
        }
    };
    
    // Drag and drop handlers
    uploadZone.ondragover = function(e) {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    };
    
    uploadZone.ondragleave = function(e) {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
    };
    
    uploadZone.ondrop = function(e) {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        
        const file = e.dataTransfer.files[0];
        if (file && file.name.endsWith('.csv')) {
            handleProjectFileUpload(file);
        } else {
            showNotification('Please upload a CSV file', 'error');
        }
    };
    
    // Set up goal action buttons
    const selectAllBtn = document.getElementById('project-select-all-goals');
    const deselectAllBtn = document.getElementById('project-deselect-all-goals');
    const saveSelectedBtn = document.getElementById('project-save-selected-goals');
    
    if (selectAllBtn) {
        selectAllBtn.onclick = () => {
            document.querySelectorAll('.goal-checkbox').forEach(cb => {
                cb.checked = true;
                projectSelectedGoals.add(cb.dataset.goalId);
            });
        };
    }
    
    if (deselectAllBtn) {
        deselectAllBtn.onclick = () => {
            document.querySelectorAll('.goal-checkbox').forEach(cb => {
                cb.checked = false;
                projectSelectedGoals.delete(cb.dataset.goalId);
            });
        };
    }
    
    if (saveSelectedBtn) {
        saveSelectedBtn.onclick = saveSelectedProjectGoals;
    }
}

function resetProjectImportState() {
    const processingStatus = document.getElementById('project-processing-status');
    const generatedGoals = document.getElementById('project-generated-goals');
    
    if (processingStatus) processingStatus.style.display = 'none';
    if (generatedGoals) generatedGoals.style.display = 'none';
    
    projectCurrentProcessingJob = null;
    projectSelectedGoals.clear();
}

async function handleProjectFileUpload(file) {
    try {
        if (!currentProject) {
            showNotification('No project selected', 'error');
            return;
        }
        
        // Show processing status
        const processingStatus = document.getElementById('project-processing-status');
        const generatedGoals = document.getElementById('project-generated-goals');
        
        if (processingStatus) processingStatus.style.display = 'block';
        if (generatedGoals) generatedGoals.style.display = 'none';
        
        // Reset progress
        updateProjectProgress(0, 'Uploading file...');
        
        // Create form data
        const formData = new FormData();
        formData.append('csvFile', file);
        formData.append('projectId', currentProject.id); // Auto-assign to current project
        
        // Start processing
        const response = await fetch(`${API_BASE}/conversations/import`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Upload failed');
        }
        
        const result = await response.json();
        projectCurrentProcessingJob = result.jobId;
        
        // Start polling for progress
        pollProjectProgress();
        
    } catch (error) {
        console.error('Error uploading file:', error);
        showNotification('Error uploading file: ' + error.message, 'error');
        resetProjectImportState();
    }
}

function updateProjectProgress(percentage, message, details = null) {
    const progressFill = document.getElementById('project-progress-fill');
    const progressText = document.getElementById('project-progress-text');
    const processingDetails = document.getElementById('project-processing-details');
    
    if (progressFill) {
        progressFill.style.width = percentage + '%';
    }
    
    if (progressText) {
        progressText.textContent = message;
    }
    
    if (processingDetails && details) {
        processingDetails.innerHTML = details;
    }
}

async function pollProjectProgress() {
    if (!projectCurrentProcessingJob || isPollingProjectProgress) return;
    
    isPollingProjectProgress = true;
    
    try {
        const response = await fetch(`${API_BASE}/conversations/import/${projectCurrentProcessingJob}/status`);
        const status = await response.json();
        
        console.log('Polling status:', status);
        
        if (status.status === 'analyzing' || status.status === 'processing') {
            const percentage = (status.processed / status.total) * 100;
            updateProjectProgress(
                percentage,
                `Processing conversation ${status.processed} of ${status.total}`,
                `<div class="processing-item">Status: ${status.status}</div>`
            );
            
            // Continue polling
            isPollingProjectProgress = false;
            setTimeout(pollProjectProgress, 1000);
        } else if (status.status === 'completed') {
            updateProjectProgress(100, 'Processing completed!');
            
            // Load generated goals
            await loadProjectGeneratedGoals(projectCurrentProcessingJob);
            
            isPollingProjectProgress = false;
            
            // Hide processing status after a short delay
            setTimeout(() => {
                const processingStatus = document.getElementById('project-processing-status');
                if (processingStatus) processingStatus.style.display = 'none';
            }, 2000);
            
        } else if (status.status === 'failed' || status.status === 'error') {
            isPollingProjectProgress = false;
            throw new Error(status.error || 'Processing failed');
        }
        
    } catch (error) {
        isPollingProjectProgress = false;
        console.error('Error polling progress:', error);
        showNotification('Error processing conversations: ' + error.message, 'error');
        resetProjectImportState();
    }
}

async function loadProjectGeneratedGoals(jobId) {
    try {
        const response = await fetch(`${API_BASE}/conversations/import/${jobId}/results`);
        const results = await response.json();
        
        console.log('Results received:', results);
        
        if (results.generatedGoals && results.generatedGoals.length > 0) {
            displayProjectGeneratedGoals(results.generatedGoals);
        } else {
            showNotification('No goals were generated from the conversations', 'warning');
        }
        
    } catch (error) {
        console.error('Error loading generated goals:', error);
        showNotification('Error loading generated goals: ' + error.message, 'error');
    }
}

function displayProjectGeneratedGoals(goals) {
    const goalsSection = document.getElementById('project-generated-goals');
    const goalsList = document.getElementById('project-goals-list');
    
    if (!goalsSection || !goalsList) return;
    
    // Show the goals section
    goalsSection.style.display = 'block';
    
    // Clear previous goals
    goalsList.innerHTML = '';
    
    goals.forEach((goal, index) => {
        const goalElement = document.createElement('div');
        goalElement.className = 'goal-item';
        goalElement.innerHTML = `
            <div class="goal-header">
                <label class="goal-checkbox-label">
                    <input type="checkbox" class="goal-checkbox" data-goal-id="${index}" checked>
                    <strong>${goal.name}</strong>
                </label>
                <div class="goal-meta">
                    <span class="goal-category">${goal.category}</span>
                    <span class="goal-complexity">${goal.complexity}</span>
                    ${goal.qualityScore ? `<span class="goal-quality">Quality: ${Math.round(goal.qualityScore.overall * 100)}%</span>` : ''}
                </div>
            </div>
            <div class="goal-description">
                <p>${goal.description}</p>
            </div>
            <div class="goal-details">
                <div class="goal-section">
                    <h4>Steps:</h4>
                    <ul>
                        ${goal.steps.map(step => `<li>${step}</li>`).join('')}
                    </ul>
                </div>
                <div class="goal-section">
                    <h4>Validation Criteria:</h4>
                    <ul>
                        ${goal.validationCriteria.map(criteria => `<li>${criteria}</li>`).join('')}
                    </ul>
                </div>
                ${goal.customerScenario ? `
                    <div class="goal-section">
                        <h4>Customer Scenario:</h4>
                        <p><strong>Goal:</strong> ${goal.customerScenario.customerGoal || 'N/A'}</p>
                        <p><strong>Emotional Context:</strong> ${goal.customerScenario.emotionalContext || 'N/A'}</p>
                    </div>
                ` : ''}
            </div>
        `;
        
        goalsList.appendChild(goalElement);
        
        // Add to selected goals by default
        projectSelectedGoals.add(index.toString());
        
        // Add click handler for checkbox
        const checkbox = goalElement.querySelector('.goal-checkbox');
        checkbox.onchange = function() {
            if (this.checked) {
                projectSelectedGoals.add(this.dataset.goalId);
            } else {
                projectSelectedGoals.delete(this.dataset.goalId);
            }
        };
    });
    
    // Store goals for later use
    window.projectGeneratedGoals = goals;
}

async function saveSelectedProjectGoals() {
    if (!currentProject) {
        showNotification('No project selected', 'error');
        return;
    }
    
    if (!window.projectGeneratedGoals || projectSelectedGoals.size === 0) {
        showNotification('No goals selected', 'error');
        return;
    }
    
    try {
        const selectedGoals = Array.from(projectSelectedGoals).map(id => window.projectGeneratedGoals[parseInt(id)]);
        
        let savedCount = 0;
        const total = selectedGoals.length;
        
        for (const goal of selectedGoals) {
            const response = await fetch(`${API_BASE}/projects/${currentProject.id}/goals`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: goal.name,
                    description: goal.description,
                    steps: goal.steps,
                    validationCriteria: goal.validationCriteria,
                    sourceConversationId: goal.sourceConversationId,
                    sourceConversationData: goal.sourceConversationData,
                    category: goal.category,
                    complexity: goal.complexity,
                    expectedOutcomes: goal.expectedOutcomes,
                    customerScenario: goal.customerScenario,
                    aiConsiderations: goal.aiConsiderations,
                    metadata: goal.metadata,
                    qualityScore: goal.qualityScore
                })
            });
            
            if (response.ok) {
                savedCount++;
            }
        }
        
        showNotification(`Successfully saved ${savedCount} of ${total} goals to project`, 'success');
        
        // Refresh the project goals display
        if (currentProject) {
            await openProject(currentProject.id);
        }
        
        // Reset import state
        resetProjectImportState();
        
        // Switch to goals tab to show the new goals
        showProjectSubtab('goals');
        
    } catch (error) {
        console.error('Error saving goals:', error);
        showNotification('Error saving goals: ' + error.message, 'error');
    }
}

function resetProjectPrompt() {
    const promptTextarea = document.getElementById('project-goal-prompt');
    if (promptTextarea) {
        promptTextarea.value = '';
    }
    showNotification('Prompt reset to default. Click "Save Settings" to apply.', 'info');
}

// Utility functions
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}