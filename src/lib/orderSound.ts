import { toast } from 'sonner'

export function playOrderTone() {
  if (!window.AudioContext) {
    toast.error('This browser does not support order sounds.')
    return
  }
  const context = new window.AudioContext()
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(740, context.currentTime)
  oscillator.frequency.setValueAtTime(980, context.currentTime + 0.13)
  gain.gain.setValueAtTime(0.001, context.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.14, context.currentTime + 0.025)
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.32)
  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start()
  oscillator.stop(context.currentTime + 0.34)
  window.setTimeout(() => { void context.close() }, 500)
}
