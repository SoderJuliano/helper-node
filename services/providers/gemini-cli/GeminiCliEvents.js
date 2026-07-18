// Event name constants shared across the Gemini CLI provider module.
// Keep as plain strings so they survive JSON serialisation.

const GeminiCliEvents = {
  // Process lifecycle
  STARTING:    'gemini-cli:starting',
  CONNECTED:   'gemini-cli:connected',
  WAITING:     'gemini-cli:waiting',
  BUSY:        'gemini-cli:busy',
  STREAMING:   'gemini-cli:streaming',
  FINISHED:    'gemini-cli:finished',
  ERROR:       'gemini-cli:error',
  RESTARTING:  'gemini-cli:restarting',
  CLOSED:      'gemini-cli:closed',

  // Response payload
  CHUNK:       'gemini-cli:chunk',          // streaming text token
  THINKING:    'gemini-cli:thinking',       // thinking/planning text
  TOOL_START:  'gemini-cli:tool-start',     // tool execution began
  TOOL_DONE:   'gemini-cli:tool-done',      // tool execution finished
  RESPONSE:    'gemini-cli:response',       // full response ready
};

module.exports = GeminiCliEvents;
