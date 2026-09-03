/** Display prices for the hosted product. Stripe price IDs live in env. */
export const PRICING = {
  monthly: { amount: 9.99, label: "$9.99", period: "month" },
  annual: { amount: 99, label: "$99", period: "year", save: "2 months free" },
} as const;

export type PricingPlan = keyof typeof PRICING;
