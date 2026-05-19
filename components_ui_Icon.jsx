/**
 * ============================================================
 * APEX AI — Icon Component
 * /src/components/ui/Icon.jsx
 *
 * Dynamic icon loader from lucide-react.
 * ============================================================
 */

import * as Icons from 'lucide-react'

export default function Icon({ name, size = 16, className = '', ...props }) {
  const LucideIcon = Icons[name]
  if (!LucideIcon) return null
  return <LucideIcon size={size} className={className} {...props} />
}
