import { env } from "../../config/env.js"
import { mockGateway } from "./gateways/mock.gateway.js"

const gateways = {
  mock: mockGateway,
}

export const gateway = gateways[env.payments.gateway] ?? mockGateway
