// Reference: TestFlight魔法攻击/src/hooks/animateState.ts (read-only).
// Animate state commits only; native UI owns interpolation, no JS frame loop.
export function animateState(change: () => void): void {
  void withAnimation(Animation.smooth({ duration: 0.28, extraBounce: 0 }), change)
}
