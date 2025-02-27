// Main JavaScript for AI Agent Testing Center

// Initialize tooltips
document.addEventListener('DOMContentLoaded', function() {
    var tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    var tooltipList = tooltipTriggerList.map(function(tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });
    
    // Automatically close success alerts after 5 seconds
    var successAlerts = document.querySelectorAll('.alert-success');
    successAlerts.forEach(function(alert) {
        setTimeout(function() {
            new bootstrap.Alert(alert).close();
        }, 5000);
    });
    
    // Add click-to-copy functionality for code blocks
    document.querySelectorAll('pre code').forEach(function(block) {
        // Create the copy button
        var button = document.createElement('button');
        button.className = 'btn btn-sm btn-outline-secondary copy-btn';
        button.innerHTML = '<i class="fas fa-copy"></i>';
        button.title = 'Copy to clipboard';
        button.style.position = 'absolute';
        button.style.top = '0.5rem';
        button.style.right = '0.5rem';
        
        // Add the button to the code block parent
        var pre = block.parentNode;
        pre.style.position = 'relative';
        pre.appendChild(button);
        
        // Add copy functionality
        button.addEventListener('click', function() {
            var textToCopy = block.textContent;
            
            navigator.clipboard.writeText(textToCopy).then(function() {
                // Success
                button.innerHTML = '<i class="fas fa-check"></i>';
                setTimeout(function() {
                    button.innerHTML = '<i class="fas fa-copy"></i>';
                }, 2000);
            }).catch(function(err) {
                // Error
                console.error('Could not copy text: ', err);
                button.innerHTML = '<i class="fas fa-times"></i>';
                setTimeout(function() {
                    button.innerHTML = '<i class="fas fa-copy"></i>';
                }, 2000);
            });
        });
    });
});

// Function to format JSON in textareas
function formatJson(elementId) {
    const textarea = document.getElementById(elementId);
    if (!textarea) return;
    
    try {
        const json = JSON.parse(textarea.value);
        textarea.value = JSON.stringify(json, null, 2);
    } catch (e) {
        console.error('Invalid JSON:', e);
    }
}

// Function to validate a JSON string
function isValidJson(jsonString) {
    try {
        JSON.parse(jsonString);
        return true;
    } catch (e) {
        return false;
    }
}

// Function to confirm dangerous actions
function confirmAction(message) {
    return confirm(message || 'Are you sure you want to perform this action?');
}

// Function to show loading spinner
function showLoading(buttonElement, loadingText) {
    const originalText = buttonElement.innerHTML;
    buttonElement.disabled = true;
    buttonElement.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ${loadingText || 'Loading...'}`;
    
    return function hideLoading() {
        buttonElement.disabled = false;
        buttonElement.innerHTML = originalText;
    };
}

// Function to handle form submission with validation
function validateAndSubmitForm(formId, validationFunction) {
    const form = document.getElementById(formId);
    if (!form) return;
    
    form.addEventListener('submit', function(event) {
        if (typeof validationFunction === 'function') {
            const isValid = validationFunction();
            if (!isValid) {
                event.preventDefault();
                return false;
            }
        }
        
        const submitButton = form.querySelector('button[type="submit"]');
        if (submitButton) {
            showLoading(submitButton, 'Submitting...');
        }
        
        return true;
    });
}

// Loading indicator for test runs

// Show loading overlay with spinner
function showLoadingOverlay(message = 'Running test...') {
    // Create overlay if it doesn't exist
    if (!document.getElementById('loadingOverlay')) {
      const overlay = document.createElement('div');
      overlay.id = 'loadingOverlay';
      overlay.className = 'loading-overlay';
      
      // Create spinner container
      const spinnerContainer = document.createElement('div');
      spinnerContainer.className = 'spinner-container';
      
      // Create spinner
      const spinner = document.createElement('div');
      spinner.className = 'spinner-border text-primary';
      spinner.setAttribute('role', 'status');
      
      // Create spinner text
      const spinnerText = document.createElement('span');
      spinnerText.className = 'spinner-text mt-3';
      spinnerText.id = 'spinnerText';
      spinnerText.textContent = message;
      
      // Assemble the elements
      spinnerContainer.appendChild(spinner);
      spinnerContainer.appendChild(spinnerText);
      overlay.appendChild(spinnerContainer);
      
      // Add the overlay to the body
      document.body.appendChild(overlay);
      
      // Prevent scrolling while overlay is active
      document.body.style.overflow = 'hidden';
    } else {
      // Update message if overlay already exists
      document.getElementById('spinnerText').textContent = message;
      document.getElementById('loadingOverlay').style.display = 'flex';
    }
  }
  
  // Hide loading overlay
  function hideLoadingOverlay() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
      overlay.style.display = 'none';
      document.body.style.overflow = 'auto';
    }
  }
  
  // Update progress message
  function updateLoadingMessage(message) {
    const spinnerText = document.getElementById('spinnerText');
    if (spinnerText) {
      spinnerText.textContent = message;
    }
  }
  
  // Add event listeners to test run forms
  document.addEventListener('DOMContentLoaded', function() {
    // For the run test form
    const testRunForm = document.querySelector('form#runTestForm');
    if (testRunForm) {
      testRunForm.addEventListener('submit', function() {
        showLoadingOverlay('Initializing test run...');
        
        // Simulate progress updates (in a real application, you might use WebSockets or polling)
        setTimeout(() => updateLoadingMessage('Connecting to AI Agent...'), 1500);
        setTimeout(() => updateLoadingMessage('Sending conversation turns...'), 3000);
        setTimeout(() => updateLoadingMessage('Validating responses...'), 6000);
        
        return true;
      });
    }
  });
  
  // Function to check test run status periodically
  function pollTestRunStatus(testRunId, intervalMs = 2000) {
    if (!testRunId) return;
    
    showLoadingOverlay('Test is running...');
    
    const statusCheckInterval = setInterval(function() {
      fetch(`/api/test_runs/${testRunId}/status`)
        .then(response => response.json())
        .then(data => {
          if (data.status !== 'running') {
            clearInterval(statusCheckInterval);
            hideLoadingOverlay();
            
            // Redirect to results page
            window.location.href = `/runs/${testRunId}`;
          } else {
            // Update progress message
            updateLoadingMessage(`${data.current_turn ? 'Processing turn ' + data.current_turn : 'Test is running...'}`);
          }
        })
        .catch(error => {
          console.error('Error checking test status:', error);
          // Continue polling even if there's an error
        });
    }, intervalMs);
    
    // Safety timeout after 5 minutes
    setTimeout(function() {
      clearInterval(statusCheckInterval);
      hideLoadingOverlay();
    }, 5 * 60 * 1000);
  }