// PURE. A coded error: a source's extractor throws it for a message it claimed but cannot read (DDD-10).
// The registry contains this code and nothing else, so any other error still stops the build.

export const UNREADABLE_MESSAGE = 'source.unreadable-message';

export const refuseMessage = (reason) => {
  throw Object.assign(new Error(reason), { code: UNREADABLE_MESSAGE });
};

export const isUnreadableMessage = (error) => error?.code === UNREADABLE_MESSAGE;
