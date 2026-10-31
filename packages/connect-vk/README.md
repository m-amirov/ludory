# @ludory/connect-vk

V1 is an isolated, injected VK Bridge contract adapter for VK Games. It never imports browser globals at module import time and does not auto-load a script. `bridgeLoader` must provide the official VK Bridge instance with `send`, `subscribe`, `unsubscribe`.

```js
import { createVkConnector } from '@ludory/connect-vk';
import bridge from '@vkontakte/vk-bridge'; // game-owned VK entrypoint (V4)
const connector = createVkConnector({ bridgeLoader: async () => bridge });
const { bridge: initialized, livePlatformVerified } = await connector.initialize();
const advertised = await connector.probeCapabilities();
```

`DECLARED_SUPPORTED` is only a capability advertisement. Contract tests using a fake Bridge are not live VK acceptance. V2/V3/V4 implement storage/lifecycle, ads and isolated bundle respectively.
