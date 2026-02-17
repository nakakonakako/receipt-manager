import axios from 'axios'

const API_URL = '/api'

export const getApiKey = () => sessionStorage.getItem('receipt_app_key') || ''

export const apiClient = axios.create({
  baseURL: API_URL,
})

apiClient.interceptors.request.use((config) => {
  const token = getApiKey()
  if (token) {
    config.headers['x-api-key'] = token
  }
  return config
})
