/**
 * Script to match existing goals with conversation IDs from original CSV
 * Usage: node scripts/match_conversation_ids.js path/to/original.csv
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { db } = require('../src/database/init');

async function matchConversationIds(csvPath) {
    try {
        console.log('Reading CSV file:', csvPath);
        const csvContent = fs.readFileSync(csvPath, 'utf8');
        
        const records = parse(csvContent, {
            columns: true,
            skip_empty_lines: true,
            trim: true
        });
        
        console.log(`Found ${records.length} records in CSV`);
        
        // Get all goals without conversation IDs
        const goals = await new Promise((resolve, reject) => {
            db.all('SELECT id, name, description FROM goals WHERE source_conversation_id IS NULL', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        console.log(`Found ${goals.length} goals without conversation IDs`);
        
        let matchCount = 0;
        let updatePromises = [];
        
        // Try to match by generating goals again and comparing names/descriptions
        for (const record of records) {
            const conversationId = record.conversation_id;
            if (!conversationId) continue;
            
            // Find goals that might match this conversation
            // This is fuzzy matching - you might need to adjust logic based on your data
            const matchingGoals = goals.filter(goal => {
                // Simple matching by name similarity or other criteria
                // You might need to be more sophisticated here
                return record.conversation_data && (
                    goal.name.toLowerCase().includes(conversationId.toLowerCase()) ||
                    record.conversation_data.toLowerCase().includes(goal.name.toLowerCase().substring(0, 20))
                );
            });
            
            if (matchingGoals.length === 1) {
                const goal = matchingGoals[0];
                console.log(`Matching goal "${goal.name}" with conversation ${conversationId}`);
                
                updatePromises.push(new Promise((resolve, reject) => {
                    db.run('UPDATE goals SET source_conversation_id = ? WHERE id = ?', 
                        [conversationId, goal.id], 
                        function(err) {
                            if (err) reject(err);
                            else {
                                matchCount++;
                                resolve();
                            }
                        }
                    );
                }));
            }
        }
        
        await Promise.all(updatePromises);
        console.log(`Successfully matched ${matchCount} goals with conversation IDs`);
        
    } catch (error) {
        console.error('Error matching conversation IDs:', error);
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    const csvPath = process.argv[2];
    if (!csvPath) {
        console.error('Usage: node scripts/match_conversation_ids.js path/to/original.csv');
        process.exit(1);
    }
    
    if (!fs.existsSync(csvPath)) {
        console.error('CSV file not found:', csvPath);
        process.exit(1);
    }
    
    matchConversationIds(csvPath);
}

module.exports = { matchConversationIds };