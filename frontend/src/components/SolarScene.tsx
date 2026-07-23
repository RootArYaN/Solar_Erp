import { motion } from 'motion/react'

export function SolarScene() {
  return (
    <div className="solar-scene" aria-hidden="true">
      <motion.div
        className="solar-scene__sun"
        animate={{ scale: [1, 1.05, 1], opacity: [0.72, 0.96, 0.72] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="solar-scene__horizon solar-scene__horizon--far" />
      <div className="solar-scene__horizon solar-scene__horizon--near" />
      <motion.div
        className="solar-scene__lightline"
        animate={{ x: ['-8%', '8%', '-8%'], rotate: [-3, 2, -3] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="solar-array">
        {Array.from({ length: 18 }).map((_, index) => (
          <motion.span
            key={index}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.02 * index, duration: 0.45 }}
          />
        ))}
      </div>
      <div className="solar-scene__grid" />
    </div>
  )
}
