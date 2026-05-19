/**
 * ============================================================
 * APEX AI — useAIChat Hook (Run 15)
 * Drives all AI conversations through the router/fallback chain.
 * Tracks messages, streaming state, token usage, module context.
 * ============================================================
 */

import { useState, useCallback, useRef } from 'react'
import { aiRouter }          from './services_ai_aiRouter'
import { aiFallbackSystem }  from './services_ai_aiFallbackSystem'
import { useAIStore }        from './core_storage'

export function useAIChat(module = null) {
  const { setStatus, updateTokenUsage, setActiveModule } = useAIStore(s => ({
    setStatus:        s.setStatus,
    updateTokenUsage: s.updateTokenUsage,
    setActiveModule:  s.setActiveModule,
  }))

  const [messages,   setMessages]   = useState([])
  const [streaming,  setStreaming]  = useState(false)
  const [error,      setError]      = useState(null)
  const [provider,   setProvider]   = useState(null)
  const abortRef = useRef(null)

  const clearMessages = useCallback(() => {
    setMessages([])
    setError(null)
  }, [])

  const sendMessage = useCallback(async (userText, opts = {}) => {
    if (!userText?.trim() || streaming) return

    setError(null)
    const userMsg = { id: Date.now(), role: 'user', content: userText, ts: new Date() }
    setMessages(prev => [...prev, userMsg])

    // placeholder streaming message
    const botId  = Date.now() + 1
    const botMsg = { id: botId, role: 'assistant', content: '', streaming: true, ts: new Date() }
    setMessages(prev => [...prev, botMsg])

    setStreaming(true)
    setStatus('streaming')
    if (module) setActiveModule(module)

    try {
      const history = messages.slice(-10).map(m => ({ role: m.role, content: m.content }))

      if (module) {
        // Module-aware routing (Sentinel, RouteMind, Predict, etc.)
        const result = await aiRouter.routeModule(module, userText, { history })
        const content = result?.content || result || ''
        setProvider(result?.provider || null)
        setMessages(prev => prev.map(m =>
          m.id === botId ? { ...m, content, streaming: false, provider: result?.provider } : m
        ))
        if (result?.usage) {
          updateTokenUsage({ prompt: result.usage.prompt_tokens || 0, completion: result.usage.completion_tokens || 0, total: result.usage.total_tokens || 0 })
        }
      } else {
        // Generic stream
        const fullMessages = [
          { role: 'system', content: 'You are an expert AI assistant embedded in the Apex Intelligent AI Fleet Control OS. Be concise, accurate, and enterprise-grade in tone.' },
          ...history,
          { role: 'user', content: userText },
        ]

        let accumulated = ''
        const providerUsed = await aiRouter.stream(
          { messages: fullMessages, ...(opts.model ? { model: opts.model } : {}) },
          (chunk, full) => {
            accumulated = full
            setMessages(prev => prev.map(m =>
              m.id === botId ? { ...m, content: full, streaming: true } : m
            ))
          }
        )

        setProvider(providerUsed?.provider || aiFallbackSystem.getPrimary())
        setMessages(prev => prev.map(m =>
          m.id === botId ? { ...m, content: accumulated, streaming: false, provider: providerUsed?.provider } : m
        ))
      }
    } catch (err) {
      console.error('[useAIChat] Error:', err)
      setError(err.message || 'AI request failed')
      setMessages(prev => prev.map(m =>
        m.id === botId ? { ...m, content: `⚠ ${err.message || 'Request failed. Check your API keys.'}`, streaming: false, error: true } : m
      ))
    } finally {
      setStreaming(false)
      setStatus('idle')
    }
  }, [messages, streaming, module, setStatus, updateTokenUsage, setActiveModule])

  return { messages, streaming, error, provider, sendMessage, clearMessages }
}

export default useAIChat
