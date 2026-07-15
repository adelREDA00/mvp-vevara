import React from 'react'
import { Upload, FileImage } from 'lucide-react'

function EmptyStateCanvas({
  onUpload,
  onTrySample,
  theme,
  zoom,
}) {
  const isLight = theme === 'light'

  let scale = 1
  if (zoom) {
    if (zoom <= 20) {
      scale = Math.max(0.32, zoom / 50)
    } else {
      scale = Math.max(0.5, Math.min(1, 0.55 + (zoom / 100) * 0.45))
    }
  }

  const screenTransform = {
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: `translate(-50%, -50%) scale(${scale})`,
  }

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        ...screenTransform,
        zIndex: 10,
      }}
    >
      <div
        className="pointer-events-auto select-none flex flex-col items-center"
        style={{
          width: 'min(320px, 75vw)',
          textAlign: 'center',
          background: 'transparent',
          border: 'none',
          padding: 0,
        }}
      >
        {/* <p
          className="font-medium tracking-tight m-0"
          style={{
            fontSize: '15px',
            marginBottom: '20px',
            color: isLight ? '#9ca3af' : '#6b7280',
            lineHeight: 1.4,
          }}
        >
          Start Creating
        </p> */}
        <button
          onClick={onTrySample}
          className="flex items-center gap-2 rounded-lg font-medium transition-colors"
          style={{
            padding: '9px 18px',
            fontSize: '25px',
            border: 'none',
            cursor: 'pointer',
            color: '#FFFFFF',
            outline: 'none',
            fontWeight: 600,
            background: 'linear-gradient(90deg, #6D3FE0 0%, #7C4AF0 100%)',
            borderRadius: '8px',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'linear-gradient(90deg, #6236D5 0%, #7040E8 100%)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'linear-gradient(90deg, #6D3FE0 0%, #7C4AF0 100%)'
          }}


        >
          <FileImage size={20} strokeWidth={2} />
          Try Sample
        </button>



        <div className="flex items-center gap-2" style={{ margin: '12px 0', width: '100%' }}>
          <div
            style={{
              flex: 1,
              height: '1px',
              background: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)',
            }}
          />
          <span
            style={{
              fontSize: '13px',
              fontWeight: 500,
              color: isLight ? '#b0b7c3' : '#555',
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
            }}
          >
            Or
          </span>
          <div
            style={{
              flex: 1,
              height: '1px',
              background: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)',
            }}
          />
        </div>
        <button
          onClick={onUpload}
          className="flex items-center gap-2 rounded-lg font-medium transition-colors"
          style={{
            padding: '8px 16px',
            fontSize: '16px',
            border: 'none',
            cursor: 'pointer',
            background: 'transparent',
            color: isLight ? '#9ca3af' : '#6b7280',
            outline: 'none',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = isLight
              ? 'rgba(0,0,0,0.04)'
              : 'rgba(255,255,255,0.05)'
            e.currentTarget.style.color = isLight ? '#4b5563' : '#d1d5db'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = isLight ? '#9ca3af' : '#6b7280'
          }}

        >
          <Upload size={16} strokeWidth={2} />
          Upload Your Asset
        </button>


      </div>
    </div>
  )
}

export default React.memo(EmptyStateCanvas)