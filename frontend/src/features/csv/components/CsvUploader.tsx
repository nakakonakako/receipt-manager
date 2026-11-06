import React from 'react'
import { CsvAnalysisForm } from './CsvAnalysisForm'
import { CsvEditorTable } from './CsvEditorTable'
import { useCsvUploader } from '../hooks/useCsvUploader'
import { CsvPresetSaveModal } from './CsvPresetSaveModal'
import { CsvPresetDeleteModal } from './CsvPresetDeleteModal'
import { CsvPresetRenameModal } from './CsvPresetRenameModal'
import { CsvPresetIconModal } from './CsvPresetIconModal'
import { resolvePresetIcon } from '../utils/emoji'
import { formatPresetLastUsedLabel } from '../utils/date'

export const CsvUploader: React.FC = () => {
  const {
    fileInputRef,
    isLoadingPresets,
    csvText,
    isAnalyzing,
    parsedData,
    isSaving,
    isWaiting,
    waitTime,
    progress,
    presets,
    selectedPresetId,
    newPresetName,
    newPresetIcon,
    showPresetSaveModal,
    renameTarget,
    editPresetName,
    deleteTarget,
    iconTarget,
    editPresetIcon,
    setSelectedPresetId,
    setNewPresetName,
    setNewPresetIcon,
    setEditPresetName,
    setEditPresetIcon,
    handleFileChange,
    handleAnalyze,
    handleSavePreset,
    handleSkipPresetSave,
    openRenameModal,
    closeRenameModal,
    executeRenamePreset,
    openDeleteModal,
    closeDeleteModal,
    executeDeletePreset,
    openIconModal,
    closeIconModal,
    executeUpdateIcon,
    handleDataChange,
    handleDeleteRow,
    handleReset,
    handleSaveClick,
  } = useCsvUploader()

  return (
    <div className="p-4 space-y-6 max-w-4xl mx-auto">
      {!csvText && (
        <div className="rounded-lg border border-dashed border-[var(--rm-border)] bg-[var(--rm-surface-subtle)] p-6 text-center">
          <input
            type="file"
            accept=".csv"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="rm-field w-full cursor-pointer text-sm text-[var(--rm-text-secondary)] file:mr-3 file:cursor-pointer file:border-0 file:border-r file:border-[var(--rm-border)] file:bg-[var(--rm-surface-muted)] file:px-3 file:py-2 file:font-medium file:text-[var(--rm-text-secondary)] hover:file:bg-stone-200"
          />
          <p className="mt-3 text-xs text-[var(--rm-text-muted)]">
            1ファイルあたり20,000行（ヘッダー含む）・20MiBまで。複数年の履歴を含められます。
          </p>
        </div>
      )}

      {!csvText && (
        <div className="rm-card mt-6 min-h-[120px] p-4">
          <h3 className="mb-3 font-bold text-[var(--rm-text-primary)]">
            保存済みの抽出ルール管理
          </h3>

          {isLoadingPresets ? (
            <div className="animate-pulse space-y-2">
              <div className="h-12 w-full animate-pulse rounded border border-[var(--rm-border-subtle)] bg-[var(--rm-surface-muted)]"></div>
              <div className="h-12 w-full animate-pulse rounded border border-[var(--rm-border-subtle)] bg-[var(--rm-surface-muted)]"></div>
            </div>
          ) : presets.length > 0 ? (
            <div className="space-y-2">
              {presets.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-col gap-2 rounded-lg border border-[var(--rm-border-subtle)] bg-[var(--rm-surface-subtle)] p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      type="button"
                      onClick={() => openIconModal(p.id!, p.name, p.icon)}
                      title="アイコンを変更"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--rm-border)] bg-[var(--rm-surface)] text-lg transition-colors hover:bg-[var(--rm-surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rm-focus)]"
                    >
                      {resolvePresetIcon(p.icon)}
                    </button>
                    <div className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-[var(--rm-text-primary)]">
                        {p.name}
                      </span>
                      <span className="text-xs text-[var(--rm-text-muted)]">
                        {formatPresetLastUsedLabel(p.last_used_at)}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => openRenameModal(p.id!, p.name)}
                      className="min-h-11 flex-1 whitespace-nowrap rounded-md border border-[var(--rm-border)] bg-[var(--rm-surface)] px-3 py-1.5 text-sm font-medium text-[var(--rm-text-secondary)] transition-colors hover:bg-[var(--rm-surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rm-focus)] sm:flex-none"
                    >
                      名前変更
                    </button>
                    <button
                      onClick={() => openDeleteModal(p.id!, p.name)}
                      className="min-h-11 flex-1 whitespace-nowrap rounded-md border border-[var(--rm-border)] bg-[var(--rm-surface)] px-3 py-1.5 text-sm font-medium text-[var(--rm-danger)] transition-colors hover:bg-[var(--rm-danger-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rm-focus)] sm:flex-none"
                    >
                      削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-[var(--rm-border-subtle)] bg-[var(--rm-surface-subtle)] py-6 text-center text-sm text-[var(--rm-text-muted)]">
              保存されたプリセットはありません。
              <br />
              CSVを解析した後に、プリセットに名前を付けて保存できます。
            </div>
          )}
        </div>
      )}

      {csvText && parsedData.length === 0 && (
        <CsvAnalysisForm
          csvText={csvText}
          presets={presets}
          selectedPresetId={selectedPresetId}
          onSelectPreset={setSelectedPresetId}
          isAnalyzing={isAnalyzing}
          onAnalyze={handleAnalyze}
          onReset={handleReset}
        />
      )}

      {parsedData.length > 0 && (
        <CsvEditorTable
          csvText={csvText}
          parsedData={parsedData}
          onDataChange={handleDataChange}
          onDeleteRow={handleDeleteRow}
          isSaving={isSaving}
          isWaiting={isWaiting}
          waitTime={waitTime}
          progress={progress}
          onReset={handleReset}
          onSaveClick={handleSaveClick}
        />
      )}

      <CsvPresetSaveModal
        isOpen={showPresetSaveModal}
        presetName={newPresetName}
        presetIcon={newPresetIcon}
        onNameChange={setNewPresetName}
        onIconChange={setNewPresetIcon}
        onSkip={handleSkipPresetSave}
        onSave={handleSavePreset}
      />

      <CsvPresetRenameModal
        isOpen={!!renameTarget}
        currentName={renameTarget?.name || ''}
        editName={editPresetName}
        onNameChange={setEditPresetName}
        onClose={closeRenameModal}
        onSave={executeRenamePreset}
      />

      <CsvPresetDeleteModal
        isOpen={!!deleteTarget}
        targetName={deleteTarget?.name || ''}
        onClose={closeDeleteModal}
        onDelete={executeDeletePreset}
      />

      <CsvPresetIconModal
        isOpen={!!iconTarget}
        presetName={iconTarget?.name || ''}
        value={editPresetIcon}
        onChange={setEditPresetIcon}
        onClose={closeIconModal}
        onSave={executeUpdateIcon}
      />
    </div>
  )
}
