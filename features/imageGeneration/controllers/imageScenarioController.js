import imageScenarioService from '../services/imageScenarioService.js';
import {
  IMAGE_SCENARIO_RUN_TRIGGER,
  IMAGE_SCENARIO_RUN_TRIGGER_VALUES
} from '../constants/imageGenerationConstants.js';

class ImageScenarioController {
  async list (req, res) {
    try {
      const scenarios = await imageScenarioService.listScenarios({
        userId: req.user._id,
        status: req.query.status
      });

      res.status(200).json({
        success: true,
        data: { scenarios }
      });
    } catch (error) {
      req.log?.error({ err: error, userId: req.user?._id }, 'Failed to list image scenarios');
      res.status(500).json({
        success: false,
        message: 'Unable to load image scenarios'
      });
    }
  }

  async get (req, res) {
    try {
      const scenario = await imageScenarioService.getScenario({
        userId: req.user._id,
        scenarioId: req.params.scenarioId
      });

      if (!scenario) {
        return res.status(404).json({
          success: false,
          message: 'Scenario not found'
        });
      }

      res.status(200).json({
        success: true,
        data: { scenario }
      });
    } catch (error) {
      req.log?.error({ err: error, userId: req.user?._id }, 'Failed to load image scenario');
      res.status(500).json({
        success: false,
        message: 'Unable to load image scenario'
      });
    }
  }

  async create (req, res) {
    try {
      const scenario = await imageScenarioService.createScenario({
        userId: req.user._id,
        payload: req.body
      });

      res.status(201).json({
        success: true,
        data: { scenario }
      });
    } catch (error) {
      req.log?.error({ err: error, userId: req.user?._id }, 'Failed to create image scenario');
      res.status(400).json({
        success: false,
        message: error.message || 'Unable to create scenario'
      });
    }
  }

  async update (req, res) {
    try {
      const scenario = await imageScenarioService.updateScenario({
        userId: req.user._id,
        scenarioId: req.params.scenarioId,
        payload: req.body
      });

      if (!scenario) {
        return res.status(404).json({
          success: false,
          message: 'Scenario not found'
        });
      }

      res.status(200).json({
        success: true,
        data: { scenario }
      });
    } catch (error) {
      req.log?.error({ err: error, userId: req.user?._id }, 'Failed to update image scenario');
      res.status(400).json({
        success: false,
        message: error.message || 'Unable to update scenario'
      });
    }
  }

  async remove (req, res) {
    try {
      const removed = await imageScenarioService.deleteScenario({
        userId: req.user._id,
        scenarioId: req.params.scenarioId
      });

      if (!removed) {
        return res.status(404).json({
          success: false,
          message: 'Scenario not found'
        });
      }

      res.status(200).json({
        success: true,
        message: 'Scenario deleted'
      });
    } catch (error) {
      req.log?.error({ err: error, userId: req.user?._id }, 'Failed to delete image scenario');
      res.status(500).json({
        success: false,
        message: 'Unable to delete scenario'
      });
    }
  }

  async runOnce (req, res) {
    try {
      const trigger = IMAGE_SCENARIO_RUN_TRIGGER_VALUES.includes(req.body?.trigger)
        ? req.body.trigger
        : IMAGE_SCENARIO_RUN_TRIGGER.MANUAL;

      const run = await imageScenarioService.triggerRun({
        userId: req.user._id,
        scenarioId: req.params.scenarioId,
        trigger
      });

      if (!run) {
        return res.status(404).json({
          success: false,
          message: 'Scenario not found'
        });
      }

      res.status(202).json({
        success: true,
        message: 'Scenario run enqueued',
        data: { run }
      });
    } catch (error) {
      req.log?.error({ err: error, userId: req.user?._id }, 'Failed to enqueue image scenario run');
      res.status(400).json({
        success: false,
        message: error.message || 'Unable to run scenario'
      });
    }
  }
}

export default new ImageScenarioController();
