import { forwardRef, memo, useCallback, useImperativeHandle, useRef, useState, type ClipboardEvent } from 'react'
import { flushSync } from 'react-dom'
import {
  CloseCircleOutlined,
  CloseOutlined,
  FileTextOutlined,
  LoadingOutlined,
  PaperClipOutlined,
  SendOutlined,
} from '@ant-design/icons'
import { Button, Input, Tooltip } from 'antd'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import {
  collectClipboardFiles,
  isDocumentFile,
  isImageFile,
  type PendingDocument,
} from '../api/docUpload'
export interface ComposerStackHandle {
  /** 仅当输入框为空且用户未在打字时写入（避免覆盖正在输入的内容） */
  setTextIfIdle: (text: string) => void
}

interface ComposerStackProps {
  canStopCurrentTurn: boolean
  docUploads: Array<{ id: string; filename: string }>
  historySyncState: 'syncing' | 'synced' | 'fallback'
  isThinking: boolean
  isTranscribing: boolean
  isVoiceMode: boolean
  pendingDocuments: PendingDocument[]
  pendingImages: string[]
  onAppendImages: (files: FileList | File[]) => void
  onEnterVoiceMode: () => void
  onExitVoiceMode: () => void
  onProcessDocumentPaste: (files: File[]) => void
  onRemovePendingDocument: (id: string) => void
  onRemovePendingImage: (index: number) => void
  onSend: (text: string) => boolean
  onStopCurrentTurn: () => void
  suppressFor: (durationMs: number) => void
}

const ComposerStack = memo(forwardRef<ComposerStackHandle, ComposerStackProps>(function ComposerStack({
  canStopCurrentTurn,
  docUploads,
  historySyncState,
  isThinking,
  isTranscribing,
  isVoiceMode,
  pendingDocuments,
  pendingImages,
  onAppendImages,
  onEnterVoiceMode,
  onExitVoiceMode,
  onProcessDocumentPaste,
  onRemovePendingDocument,
  onRemovePendingImage,
  onSend,
  onStopCurrentTurn,
  suppressFor,
}, ref) {
  const [input, setInput] = useState('')
  const inputTextAreaRef = useRef<TextAreaRef>(null)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const typingUntilRef = useRef(0)
  const inputValueRef = useRef('')

  inputValueRef.current = input

  useImperativeHandle(ref, () => ({
    setTextIfIdle(text: string) {
      const trimmed = text.trim()
      if (!trimmed) return
      if (performance.now() < typingUntilRef.current) return
      if (inputValueRef.current.trim()) return
      setInput(trimmed)
    },
  }))

  const markTyping = useCallback(() => {
    typingUntilRef.current = performance.now() + 1_500
  }, [])

  const hasInputText = input.trim().length > 0
  const canSendComposer = hasInputText || pendingImages.length > 0
  const docParsingInProgress = docUploads.length > 0
  const primaryAction: 'send' | 'voice' | 'close' = canSendComposer ? 'send' : isVoiceMode ? 'close' : 'voice'
  const primaryDisabled = primaryAction === 'send'
    && (historySyncState === 'syncing' || isThinking || isTranscribing || docParsingInProgress)

  const handleSend = useCallback(() => {
    const trimmed = inputValueRef.current.trim()
    if (primaryAction !== 'send' || primaryDisabled) return
    flushSync(() => setInput(''))
    if (!onSend(trimmed)) {
      flushSync(() => setInput(trimmed))
    }
  }, [onSend, primaryAction, primaryDisabled])

  const handleComposerPaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items
    const clipboardFiles = items ? collectClipboardFiles(items) : []
    const legacyFiles = event.clipboardData?.files ? Array.from(event.clipboardData.files) : []
    const allFiles = clipboardFiles.length > 0 ? clipboardFiles : legacyFiles
    if (allFiles.length === 0) return

    const imageFiles = allFiles.filter(isImageFile)
    const documentFiles = allFiles.filter(isDocumentFile)
    if (imageFiles.length === 0 && documentFiles.length === 0) return

    event.preventDefault()
    if (imageFiles.length > 0) onAppendImages(imageFiles)
    if (documentFiles.length > 0) onProcessDocumentPaste(documentFiles)
  }, [onAppendImages, onProcessDocumentPaste])

  const primaryButton = (() => {
    if (primaryAction === 'send') {
      return (
        <Button
          type="primary"
          shape="circle"
          data-testid="composer-primary-button"
          data-state="send"
          icon={<SendOutlined />}
          onClick={handleSend}
          loading={isThinking}
          disabled={primaryDisabled}
          aria-label="发送消息"
        />
      )
    }
    if (primaryAction === 'close') {
      return (
        <Button
          shape="circle"
          className="composer-voice-button composer-voice-button-close"
          data-testid="composer-primary-button"
          data-state="close"
          icon={<CloseOutlined />}
          onClick={onExitVoiceMode}
          aria-label="退出语音模式"
        />
      )
    }
    return (
      <Button
        type="primary"
        shape="circle"
        className="composer-voice-button"
        data-testid="composer-primary-button"
        data-state="voice"
        icon={(
          <span className="voice-wave-icon" aria-hidden>
            <i /><i /><i />
          </span>
        )}
        onClick={onEnterVoiceMode}
        aria-label="切换语音模式"
      />
    )
  })()

  return (
    <footer className="composer">
      <div className="composer-stack">
        {docUploads.length > 0 && (
          <div className="composer-doc-upload-list" aria-live="polite">
            {docUploads.map((upload) => (
              <div key={upload.id} className="composer-doc-upload">
                <LoadingOutlined spin />
                <span>{`📄 正在上传 ${upload.filename}…`}</span>
              </div>
            ))}
          </div>
        )}
        {pendingDocuments.length > 0 && (
          <div className="composer-doc-preview">
            {pendingDocuments.map((doc) => (
              <div key={doc.id} className="composer-doc-chip">
                <FileTextOutlined />
                <span className="composer-doc-chip-name" title={doc.filename}>{doc.filename}</span>
                <Button
                  type="text"
                  size="small"
                  shape="circle"
                  icon={<CloseCircleOutlined />}
                  onClick={() => onRemovePendingDocument(doc.id)}
                  aria-label={`移除文档 ${doc.filename}`}
                />
              </div>
            ))}
          </div>
        )}
        {pendingImages.length > 0 && (
          <div className="composer-image-preview">
            {pendingImages.map((src, index) => (
              <div key={`${src.slice(0, 32)}-${index}`} className="composer-image-chip">
                <img src={src} alt={`待发送图片 ${index + 1}`} />
                <Button
                  type="text"
                  size="small"
                  shape="circle"
                  icon={<CloseCircleOutlined />}
                  onClick={() => onRemovePendingImage(index)}
                  aria-label="移除图片"
                />
              </div>
            ))}
          </div>
        )}
        <div className="composer-input-shell">
          <input
            ref={attachmentInputRef}
            className="composer-file-input"
            type="file"
            multiple
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              const imageFiles = files.filter(isImageFile)
              const documentFiles = files.filter(isDocumentFile)
              if (imageFiles.length > 0) onAppendImages(imageFiles)
              if (documentFiles.length > 0) onProcessDocumentPaste(documentFiles)
              event.target.value = ''
            }}
            aria-label="选择附件"
          />
          <Tooltip title="添加图片或文档">
            <Button
              type="text"
              shape="circle"
              className="composer-attachment-button"
              icon={<PaperClipOutlined />}
              onClick={() => attachmentInputRef.current?.click()}
              aria-label="添加附件"
            />
          </Tooltip>
          <Input.TextArea
            ref={inputTextAreaRef}
            className="composer-input"
            value={input}
            onChange={(event) => {
              markTyping()
              setInput(event.target.value)
            }}
            onKeyDown={(event) => {
              markTyping()
              if (!isVoiceMode) return
              if (event.ctrlKey || event.metaKey || event.altKey) return
              if (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Enter') {
                suppressFor(4000)
              }
            }}
            onPaste={handleComposerPaste}
            onPressEnter={(event) => {
              if (!event.shiftKey) {
                event.preventDefault()
                handleSend()
              }
            }}
            autoSize={{ minRows: 1, maxRows: 5 }}
            placeholder="给罗宾发送消息"
            disabled={historySyncState === 'syncing' || isTranscribing}
            aria-label="文字消息"
          />
          <div className="composer-input-actions">
            {canStopCurrentTurn ? (
              <Button
                data-testid="stop-current-turn-button"
                danger
                shape="circle"
                className="composer-stop-button"
                icon={<CloseOutlined />}
                onClick={onStopCurrentTurn}
                aria-label="停止当前回合"
              />
            ) : primaryButton}
          </div>
        </div>
      </div>
    </footer>
  )
}))

export default ComposerStack
