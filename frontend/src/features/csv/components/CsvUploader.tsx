import React from 'react'
import { CsvAnalysisForm } from './CsvAnalysisForm'
import { CsvEditorTable } from './CsvEditorTable'
import { useCsvUploader } from '../hooks/useCsvUploader'

export const CsvUploader: React.FC = () => {
  const {
    fileInputRef,
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
    setSelectedPresetId,
    setNewPresetName,
    handleFileChange,
    handleAnalyze,
    handleSavePreset,
    handleRenamePreset,
    handleDeletePreset,
    handleDataChange,
    handleDeleteRow,
    handleReset,
    handleSaveClick,
  } = useCsvUploader()

  return (
    <div className="p-4 space-y-6 max-w-4xl mx-auto">
      <div className="border-2 border-dashed border-gray-300 rounded p-6 text-center bg-white">
        <input
          type="file"
          accept=".csv"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="w-full"
        />
      </div>

      {!csvText && presets.length > 0 && (
        <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm mt-6">
          <h3 className="font-bold text-gray-700 mb-3">
            ⚙️ 保存済みの抽出ルール管理
          </h3>
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
                    onClick={() => handleRenamePreset(p.id!)}
                    className="text-sm px-3 py-1 bg-white border border-gray-300 rounded text-blue-600 hover:bg-blue-50 transition-colors"
                  >
                    ✏️ 名前変更
                  </button>
                  <button
                    onClick={() => handleDeletePreset(p.id!)}
                    className="text-sm px-3 py-1 bg-white border border-gray-300 rounded text-red-600 hover:bg-red-50 transition-colors"
                  >
                    🗑️ 削除
                  </button>
                </div>
              </div>
            ))}
          </div>
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
        />
      )}

      {parsedData.length > 0 && (
        <CsvEditorTable
          parsedData={parsedData}
          onDataChange={handleDataChange}
          onDeleteRow={handleDeleteRow}
          newPresetName={newPresetName}
          onNewPresetNameChange={setNewPresetName}
          onSavePreset={handleSavePreset}
          isSaving={isSaving}
          isWaiting={isWaiting}
          waitTime={waitTime}
          progress={progress}
          onReset={handleReset}
          onSaveClick={handleSaveClick}
        />
      )}
    </div>
  )
}
