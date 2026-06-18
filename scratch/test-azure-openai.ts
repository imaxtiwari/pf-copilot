import { AzureOpenAI } from 'openai'
import { config } from 'dotenv'
config({ path: '.env.local' })

async function testEndpoint(endpoint: string) {
  console.log(`\nTesting endpoint: ${endpoint}`)
  try {
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O || 'gpt-4o'
    console.log(`Trying deployment: ${deployment}`)
    
    const client = new AzureOpenAI({
      endpoint,
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? '2024-08-01-preview',
      deployment,
      timeout: 10_000,
      maxRetries: 0,
    })

    const response = await client.chat.completions.create({
      model: deployment,
      messages: [{ role: 'user', content: 'Say hello' }],
      max_tokens: 10,
    })
    console.log('✅ Chat Completion worked!')
    console.log('Response:', response.choices[0]?.message?.content)
  } catch (error: any) {
    console.error('❌ Chat Completion failed:', error.status, error.message)
  }

  try {
    const embeddingDeployment = process.env.AZURE_OPENAI_DEPLOYMENT_EMBEDDING || 'text-embedding-3-small'
    console.log(`Trying embedding deployment: ${embeddingDeployment}`)
    
    const client = new AzureOpenAI({
      endpoint,
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? '2024-08-01-preview',
      deployment: embeddingDeployment,
      timeout: 10_000,
      maxRetries: 0,
    })

    const response = await client.embeddings.create({
      model: embeddingDeployment,
      input: 'hello world',
    })
    console.log('✅ Embedding worked!')
    console.log('Response length:', response.data[0].embedding.length)
  } catch (error: any) {
    console.error('❌ Embedding failed:', error.status, error.message)
  }
}

async function main() {
  const currentEndpoint = process.env.AZURE_OPENAI_ENDPOINT || ''
  await testEndpoint(currentEndpoint)

  // Test cleaned up cognitiveservices endpoint
  const baseCognitive = 'https://founders-brain.cognitiveservices.azure.com/'
  await testEndpoint(baseCognitive)

  // Test standard openai endpoint
  const baseOpenAi = 'https://founders-brain.openai.azure.com/'
  await testEndpoint(baseOpenAi)
}

main().catch(console.error)
