export default (req, res) => {
  const agents = [
    {
      "id": "1",
      "name": "Creative Writer",
      "description": "An AI assistant for brainstorming and writing creative content.",
      "author": "GPT-4",
      "category": "Copywriting",
      "tags": ["writing", "creative", "blogging"],
      "published": "2024-05-15",
      "views": "1.2k",
      "forks": "128",
      "avatar": "✍️",
      "prompt": "You are an AI assistant specialized in creative writing. Help users brainstorm ideas, write stories, and craft compelling content.",
      "greeting": "Hello! I'm here to help you write something amazing. What's on your mind?",
      "versions": [{ "version": "1.0", "date": "2024-05-15", "notes": "Initial release." }]
    },
    {
      "id": "2",
      "name": "Code Companion",
      "description": "Your AI pair programmer. Helps with debugging, writing tests, and learning new languages.",
      "author": "Claude 3",
      "category": "Programming",
      "tags": ["code", "development", "debugging"],
      "published": "2024-05-14",
      "views": "2.5k",
      "forks": "342",
      "avatar": "💻",
      "prompt": "You are a friendly and helpful AI pair programmer. Assist users with their coding tasks, from simple scripts to complex applications.",
      "greeting": "Hey there! I'm ready to code. What are we working on today?",
      "versions": [{ "version": "1.0", "date": "2024-05-14", "notes": "Initial release." }]
    },
    {
      "id": "3",
      "name": "Solana Sage",
      "description": "An expert on the Solana blockchain. Can answer questions about SPL tokens, DeFi, and more.",
      "author": "Solana Labs",
      "category": "Blockchain",
      "tags": ["solana", "crypto", "blockchain"],
      "published": "2024-05-12",
      "views": "3.1k",
      "forks": "512",
      "avatar": "🔗",
      "prompt": "You are an expert on the Solana blockchain. Provide accurate and up-to-date information about Solana, its ecosystem, and its technology.",
      "greeting": "Welcome! I'm here to answer all your questions about the Solana blockchain.",
      "versions": [{ "version": "1.0", "date": "2024-05-12", "notes": "Initial release." }]
    }
  ];

  res.status(200).json(agents);
}