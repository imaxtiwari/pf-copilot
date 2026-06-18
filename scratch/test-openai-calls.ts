import { config } from 'dotenv'
config({ path: '.env.local' })
import { getGpt4o, getGpt4oMini, getEmbedding } from '../lib/azure-openai'


async function main() {
  console.log('--- Checking Clients ---')
  const gpt4o = getGpt4o()
  const gpt4oMini = getGpt4oMini()

  console.log('gpt4o deploymentName:', (gpt4o as any).deploymentName)
  console.log('gpt4o baseURL:', (gpt4o as any).baseURL)
  console.log('gpt4oMini deploymentName:', (gpt4oMini as any).deploymentName)
  console.log('gpt4oMini baseURL:', (gpt4oMini as any).baseURL)

  console.log('\n--- Testing Chat Completion on gpt4oMini ---')
  try {
    const res = await gpt4oMini.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Say hi' }]
    })
    console.log('gpt4oMini success:', res.choices[0]?.message?.content)
  } catch (err: any) {
    console.error('gpt4oMini failed:', err.status, err.message)
    console.error('Headers:', err.headers)
  }

  console.log('\n--- Testing Embedding ---')
  try {
    const vec = await getEmbedding('hello')
    console.log('getEmbedding success, length:', vec.length)
  } catch (err: any) {
    console.error('getEmbedding failed:', err.status, err.message)
  }
}

main().catch(console.error)
