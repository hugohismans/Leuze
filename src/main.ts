import { mount } from 'svelte'
import App from './App.svelte'
import './app.css'

const target = document.getElementById('app')
if (!target) throw new Error("L'élément #app est introuvable")

export default mount(App, { target })
