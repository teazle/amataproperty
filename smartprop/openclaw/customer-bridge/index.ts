import { createCustomerBridge, type BridgeConfig, type InboundEvent, type InboundContext } from './bridge';

interface PluginApi {
  pluginConfig?: Omit<BridgeConfig, 'secret'> & { secretEnv: string };
  logger: { error(message: string): void };
  on(name: 'before_dispatch', handler: (event: InboundEvent, ctx: InboundContext) => Promise<{ handled: true } | undefined>): void;
}

export default {
  id: 'smartprop-customer-bridge',
  name: 'SmartProp customer bridge',
  register(api: PluginApi) {
    if (!api.pluginConfig) throw new Error('SmartProp customer bridge configuration is required');
    const config = api.pluginConfig;
    const bridge = createCustomerBridge({ ...config, secret: process.env[config.secretEnv] ?? '' }, {
      error: message => api.logger.error(message),
    });
    // No hook timeout override: own fetch deadline settles before returning the claim.
    api.on('before_dispatch', bridge);
  },
};
