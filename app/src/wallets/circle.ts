// TODO(verify): Circle Wallets hook for contributors new to crypto.
// Plan: expose a wagmi connector here (createConnector) that signs through a user-controlled Circle wallet
// (user-controlled, never a server key), then add it to `connectors` in src/wagmi.ts.
// Nothing here may sign on anyone's behalf. Left disabled until Circle's SDK and Arc support are verified.
export const circleWalletsEnabled = false
