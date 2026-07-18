const ClaudeCliEvents = {
  STARTING:   'claude-cli:starting',
  CONNECTED:  'claude-cli:connected',
  BUSY:       'claude-cli:busy',
  STREAMING:  'claude-cli:streaming',
  DONE:       'claude-cli:done',
  ERROR:      'claude-cli:error',
  CLOSED:     'claude-cli:closed',

  CHUNK:      'claude-cli:chunk',
  THINKING:   'claude-cli:thinking',
  TOOL_START: 'claude-cli:tool-start',
  TOOL_DONE:  'claude-cli:tool-done',
  RESPONSE:   'claude-cli:response',
};

module.exports = ClaudeCliEvents;
