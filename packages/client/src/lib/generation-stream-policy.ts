interface StreamHandoffInput {
  streamingEnabled: boolean;
  shouldDisplayRawStream: boolean;
  isGameGeneration: boolean;
  isRegeneration: boolean;
  isContinuation: boolean;
}

/**
 * Fresh Roleplay streams keep ownership of the visible transcript until the
 * entire SSE lifecycle has finished. The server persists the assistant message
 * before post-processing agents run, so handing off on `message_saved` would
 * replace the animated buffer with the completed database row mid-stream.
 */
export function shouldKeepStreamLiveThroughPostProcessing(input: StreamHandoffInput): boolean {
  return (
    input.streamingEnabled &&
    input.shouldDisplayRawStream &&
    !input.isGameGeneration &&
    !input.isRegeneration &&
    !input.isContinuation
  );
}
