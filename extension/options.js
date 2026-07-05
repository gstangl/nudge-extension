const input = document.getElementById('author')
const saved = document.getElementById('saved')
chrome.storage.sync.get('nudgeAuthor', (v) => { input.value = v.nudgeAuthor || '' })
let t
input.addEventListener('input', () => {
  clearTimeout(t)
  t = setTimeout(() => {
    chrome.storage.sync.set({ nudgeAuthor: input.value.trim() }, () => {
      saved.classList.add('show')
      setTimeout(() => saved.classList.remove('show'), 1200)
    })
  }, 300)
})
