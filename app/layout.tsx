import './globals.css';
import Link from 'next/link';
import { getCurrentUser, logout } from '@/lib/auth';
import LiveSync from '@/app/components/live-sync';
export default async function Layout({children}:{children:React.ReactNode}){const user=await getCurrentUser();return <><nav className="nav"><Link href="/" className="brand">VIDEO HUB</Link>{user?<div className="row navlinks"><Link href="/sources">Sources</Link><Link href="/categories">Categories</Link><Link href="/rules">Rules</Link><Link href="/library">Library</Link><Link href="/settings">Settings</Link><form action={async()=>{'use server';await logout()}}><button className="linkbtn">Sign out</button></form><span className="user-pill">{user.displayName}</span></div>:<div className="row"><Link href="/login">Sign in</Link><Link className="btn small" href="/register">Create account</Link></div>}</nav>{user&&<LiveSync />}{children}</>}
