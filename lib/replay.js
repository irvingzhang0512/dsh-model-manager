export function wrapReplay(chunk, ref) {
    if (chunk.type !== 'finish' || !chunk.replayState)
        return chunk;
    return { ...chunk, replayState: { ...chunk.replayState, response: { $dmm: 1, provider: ref.providerId, model: ref.modelId, state: chunk.replayState.response } } };
}
export function unwrapReplay(messages) {
    return messages.map(message => {
        if (message.role !== 'assistant' || message.source.provider !== 'dsh-model-manager')
            return message;
        const replay = message.source.replayState;
        const response = replay?.response;
        if (response?.$dmm !== 1 || typeof response.provider !== 'string' || typeof response.model !== 'string')
            return message;
        return { ...message, source: { kind: 'model', provider: response.provider, model: response.model, replayState: { response: response.state, ...(replay?.blocks === undefined ? {} : { blocks: replay.blocks }) } } };
    });
}
