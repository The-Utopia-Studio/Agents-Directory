// A tiny provider registry. Adding a new observability backend or optimizer
// is: write an adapter, register(name, factory). Nothing else in the app
// needs to change — that's the scalability lever.
export function createRegistry(kind) {
  const factories = new Map();
  return {
    register(name, factory) {
      factories.set(name, factory);
      return this;
    },
    has(name) { return factories.has(name); },
    names() { return [...factories.keys()]; },
    create(name, opts) {
      const factory = factories.get(name);
      if (!factory) {
        throw new Error(
          `Unknown ${kind} provider "${name}". Registered: ${this.names().join(", ") || "(none)"}`
        );
      }
      return factory(opts);
    },
  };
}
