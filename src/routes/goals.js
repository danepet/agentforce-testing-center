const express = require('express');
const router = express.Router();
const Goal = require('../models/Goal');

router.post('/', async (req, res) => {
  try {
    const { name, description, validationCriteria, steps } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Goal name is required' });
    }

    const goal = await Goal.create({
      name,
      description,
      validationCriteria: validationCriteria || [],
      steps: steps || []
    });

    res.status(201).json(goal);
  } catch (error) {
    console.error('Error creating goal:', error);
    res.status(500).json({ error: 'Failed to create goal' });
  }
});

router.get('/', async (req, res) => {
  try {
    const goals = await Goal.findAll();
    res.json(goals);
  } catch (error) {
    console.error('Error fetching goals:', error);
    res.status(500).json({ error: 'Failed to fetch goals' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const goal = await Goal.findById(req.params.id);
    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    res.json(goal);
  } catch (error) {
    console.error('Error fetching goal:', error);
    res.status(500).json({ error: 'Failed to fetch goal' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, description, validationCriteria, steps } = req.body;
    
    const updated = await Goal.update(req.params.id, {
      name,
      description,
      validationCriteria,
      steps
    });

    if (!updated) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    const goal = await Goal.findById(req.params.id);
    res.json(goal);
  } catch (error) {
    console.error('Error updating goal:', error);
    res.status(500).json({ error: 'Failed to update goal' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Goal.delete(req.params.id);
    
    if (!deleted) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    res.json({ message: 'Goal deleted successfully' });
  } catch (error) {
    console.error('Error deleting goal:', error);
    res.status(500).json({ error: 'Failed to delete goal' });
  }
});

module.exports = router;