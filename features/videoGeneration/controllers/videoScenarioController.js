import videoScenarioService from '../services/videoScenarioService.js';
import {
  VIDEO_SCENARIO_RUN_TRIGGER,
  VIDEO_SCENARIO_RUN_TRIGGER_VALUES
} from '../constants/videoGenerationConstants.js';

class VideoScenarioController {
  async list (req, res) {
    try {
      const scenarios = await videoScenarioService.listScenarios({
        userId: req.user._id,
        status: req.query.status
      });

      res.status(200).json({
        success: true,
        data: { scenarios }
      });
    } catch (error) {
      req.log?.error({ err: error, userId: req.user?._id }, 'Failed to list video scenarios');
      res.status(500).json({
        success: false,
        message: 'Unable to load video scenarios'
      });
    }
  }

  async get (req, res) {
    try {
      const scenario = await videoScenarioService.getScenario({
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
      req.log?.error({ err: error, userId: req.user?._id }, 'Failed to load video scenario');
      res.status(500).json({
        success: false,
        message: 'Unable to load video scenario'
      });
    }
  }

  async create (req, res) {
    try {
      const scenario = await videoScenarioService.createScenario({
        userId: req.user._id,
        payload: req.body
      });

      res.status(201).json({
        success: true,
        data: { scenario }
      });
    } catch (error) {
      req.log?.error({ err: error, userId: req.user?._id }, 'Failed to create video scenario');
      res.status(400).json({
        success: false,
        message: error.message || 'Unable to create scenario'
      });
    }
  }

  async update (req, res) {
    try {
      const scenario = await videoScenarioService.updateScenario({
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
      req.log?.error({ err: error, userId: req.user?._id }, 'Failed to update video scenario');
      res.status(400).json({
        success: false,
        message: error.message || 'Unable to update scenario'
      });
    }
  }

  async remove (req, res) {
    try {
      const removed = await videoScenarioService.deleteScenario({
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
      req.log?.error({ err: error, userId: req.user?._id }, 'Failed to delete video scenario');
      res.status(500).json({
        success: false,
        message: 'Unable to delete scenario'
      });
    }
  }

  async runOnce (req, res) {
    try {
      const trigger = VIDEO_SCENARIO_RUN_TRIGGER_VALUES.includes(req.body?.trigger)
        ? req.body.trigger
        : VIDEO_SCENARIO_RUN_TRIGGER.MANUAL;

      const run = await videoScenarioService.triggerRun({
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
      req.log?.error({ err: error, userId: req.user?._id }, 'Failed to enqueue video scenario run');
      res.status(400).json({
        success: false,
        message: error.message || 'Unable to run scenario'
      });
    }
  }
}

export default new VideoScenarioController();
