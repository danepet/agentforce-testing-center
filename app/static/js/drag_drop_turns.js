// Add to static/js/drag-drop-turns.js

document.addEventListener('DOMContentLoaded', function() {
    // Check if we're on a page with conversation turns
    const conversationTurns = document.getElementById('conversationTurns');
    if (!conversationTurns) return;
    
    // Add Sortable.js
    if (typeof Sortable === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/sortablejs@1.14.0/Sortable.min.js';
        document.head.appendChild(script);
        
        script.onload = initSortable;
    } else {
        initSortable();
    }
    
    function initSortable() {
        // Initialize Sortable
        new Sortable(conversationTurns, {
            animation: 150,
            handle: '.drag-handle',
            ghostClass: 'turn-card-ghost',
            chosenClass: 'turn-card-chosen',
            dragClass: 'turn-card-drag',
            onEnd: function(evt) {
                // Update turn order
                updateTurnOrder();
            }
        });
    }
    
    function updateTurnOrder() {
        // Get all turn cards
        const turnCards = document.querySelectorAll('.turn-card');
        
        // Update order display and hidden fields
        turnCards.forEach((card, index) => {
            // Update card header with new order
            const header = card.querySelector('.card-header h5');
            if (header) {
                header.textContent = `Turn ${index + 1} - User Input`;
            }
            
            // Update hidden order field
            const orderField = document.createElement('input');
            orderField.type = 'hidden';
            orderField.name = `turn_${index}_order`;
            orderField.value = index + 1;
            
            // Remove any existing order field
            const existingOrder = card.querySelector(`input[name^="turn_"][name$="_order"]`);
            if (existingOrder) {
                existingOrder.remove();
            }
            
            // Add new order field
            card.appendChild(orderField);
        });
    }
    
    // Add drag handles to turn cards
    function addDragHandles() {
        const turnCardHeaders = document.querySelectorAll('.turn-card .card-header');
        
        turnCardHeaders.forEach(header => {
            // Skip if already has drag handle
            if (header.querySelector('.drag-handle')) return;
            
            // Create drag handle
            const dragHandle = document.createElement('div');
            dragHandle.className = 'drag-handle';
            dragHandle.innerHTML = '<i class="fas fa-grip-vertical"></i>';
            
            // Add to header
            header.insertBefore(dragHandle, header.firstChild);
        });
    }
    
    // Call once on page load
    addDragHandles();
    
    // Also add drag handle to newly added turns
    const addTurnBtn = document.getElementById('addTurnBtn');
    if (addTurnBtn) {
        addTurnBtn.addEventListener('click', function() {
            // Wait for DOM to update
            setTimeout(addDragHandles, 100);
        });
    }
});