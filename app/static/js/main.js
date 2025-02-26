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