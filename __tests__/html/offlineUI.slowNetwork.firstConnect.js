/**
 * @jest-environment ./__tests__/html/__jest__/WebChatEnvironment.js
 */

describe('offline UI', () => {
  test('should show "Taking longer than usual to connect" UI when connection is slow', () =>
    runHTMLTest('offlineUI.slowNetwork.firstConnect.html'));
});
