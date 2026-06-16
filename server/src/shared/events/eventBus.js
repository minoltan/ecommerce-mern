const EventEmitter = require('events');

/**
 * Internal domain event bus backed by Node.js EventEmitter.
 * The publish/subscribe interface mirrors Kafka semantics so that
 * swapping the transport (when extracting to microservices) is a
 * one-file change — not a redesign.
 */
class EventBus extends EventEmitter {
  publish(event, payload) {
    console.log(`[EventBus] → ${event}`, JSON.stringify(payload));
    this.emit(event, payload);
  }

  subscribe(event, handler) {
    this.on(event, async (payload) => {
      try {
        await handler(payload);
      } catch (err) {
        console.error(`[EventBus] Handler error for ${event}:`, err.message);
      }
    });
  }
}

module.exports = new EventBus();
