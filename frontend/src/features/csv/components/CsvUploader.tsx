import React from 'react'
import { CsvAnalysisForm } from './CsvAnalysisForm'
import { CsvEditorTable } from './CsvEditorTable'
import { useCsvUploader } from '../hooks/useCsvUploader'
import { CsvPresetSaveModal } from './CsvPresetSaveModal'
import { CsvPresetDeleteModal } from './CsvPresetDeleteModal'
import { CsvPresetRenameModal } from './CsvPresetRenameModal'

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
    showPresetSaveModal,
    renameTarget,
    editPresetName,
    deleteTarget,
    setSelectedPresetId,
    setNewPresetName,
    setEditPresetName,
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
    handleDataChange,
    handleDeleteRow,
    handleReset,
    handleSaveClick,
  } = useCsvUploader()

  return (
    <div className="p-4 space-y-6 max-w-4xl mx-auto">
      {!csvText && (
        <div className="border-2 border-dashed border-gray-300 rounded p-6 text-center bg-white">
          <input
            type="file"
            accept=".csv"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="w-full"
          />
        </div>
      )}

      {!csvText && (
        <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm mt-6 min-h-[120px]">
          <h3 className="font-bold text-gray-700 mb-3">
            ⚙️ 保存済みの抽出ルール管理
          </h3>

          {isLoadingPresets ? (
            <div className="animate-pulse space-y-2">
              <div className="h-12 bg-gray-100 rounded border border-gray-200 w-full"></div>
              <div className="h-12 bg-gray-100 rounded border border-gray-200 w-full"></div>
            </div>
          ) : presets.length > 0 ? (
            <div className="space-y-2">
              {presets.map((p) => (
                <div
                  key={p.id}
                  className="flex justify-between items-center p-3 bg-gray-50 rounded border border-gray-200"
                >
                  <span className="font-bold text-sm text-gray-700">
                    ☁️ {p.name}
                  </span>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => openRenameModal(p.id!, p.name)}
                      className="text-sm px-3 py-1 bg-white border border-gray-300 rounded text-blue-600 hover:bg-blue-50 transition-colors"
                    >
                      ✏️ 名前変更
                    </button>
                    <button
                      onClick={() => openDeleteModal(p.id!, p.name)}
                      className="text-sm px-3 py-1 bg-white border border-gray-300 rounded text-red-600 hover:bg-red-50 transition-colors"
                    >
                      🗑️ 削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-sm text-gray-400 border border-dashed border-gray-200 rounded bg-gray-50">
              保存されたルールはありません。
              <br />
              CSVを解析した後に、ルールに名前を付けて保存できます。
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
        onNameChange={setNewPresetName}
        onSkip={handleSkipPresetSave}
        onSave={handleSavePreset}
      />

      <CsvPresetRenameModal
        isOpen={!!renameTarget} // renameTargetがnullでなければtrue
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
    </div>
  )
}
