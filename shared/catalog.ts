import type { Profile } from './world.ts';
import { inShop } from './shopLayout.ts';
export type ClothingSlot = 'top' | 'bottoms' | 'shoes';
export type Outfit = Record<ClothingSlot, string>;
export type Appearance = Profile & Partial<Outfit>;
export type ClothingItem = { id: string; name: string; slot: ClothingSlot; model: string; price: number; colour: string; description: string };
export const STARTING_CREDITS = 1000;
export const SALARY_CREDITS = 100;
export const SALARY_INTERVAL_MS = 600_000;
export const STARTER_OUTFIT: Outfit = { top: 'starter-utility', bottoms: 'starter-chinos', shoes: 'starter-sneakers' };
export const CATALOGUE: readonly ClothingItem[] = [
 {id:'starter-utility',name:'Everyday utility jacket',slot:'top',model:'utility',price:0,colour:'#687a65',description:'Your original pocketed jacket. Your chosen starter colour.'},
 {id:'starter-chinos',name:'Everyday trousers',slot:'bottoms',model:'chinos',price:0,colour:'#52616b',description:'A clean straight leg. Part of your complimentary first outfit.'},
 {id:'starter-sneakers',name:'Everyday sneakers',slot:'shoes',model:'sneakers',price:0,colour:'#dcd6c6',description:'Leather uppers, stitched panels and a comfortable cupsole.'},
 {id:'oat-knit',name:'Oat crewneck',slot:'top',model:'knit',price:220,colour:'#c6b895',description:'A soft ribbed crewneck with a relaxed shoulder and deep cuffs.'},
 {id:'ink-knit',name:'Midnight crewneck',slot:'top',model:'knit',price:220,colour:'#354758',description:'The same easy knit in a deep evening blue.'},
 {id:'rust-bomber',name:'Terracotta bomber',slot:'top',model:'bomber',price:420,colour:'#a25c42',description:'A cropped zip jacket with ribbed collar, cuffs and waistband.'},
 {id:'indigo-denim',name:'Straight indigo jeans',slot:'bottoms',model:'jeans',price:260,colour:'#354e69',description:'A straight denim leg, copper rivets and contrast seams.'},
 {id:'moss-cargo',name:'Moss cargo trousers',slot:'bottoms',model:'cargo',price:340,colour:'#647258',description:'Roomier legs and pleated side pockets for everyday wandering.'},
 {id:'sand-chinos',name:'Sand chinos',slot:'bottoms',model:'chinos',price:180,colour:'#b8a381',description:'A warm neutral, with a tapered cuff and a clean finish.'},
 {id:'ink-trainers',name:'Ink leather trainers',slot:'shoes',model:'sneakers',price:240,colour:'#353c43',description:'Dark leather panels over a pale rubber cupsole.'},
 {id:'oxblood-boots',name:'Oxblood lace-up boots',slot:'shoes',model:'boots',price:480,colour:'#613e39',description:'Ankle-height leather, six-eye lacing and a sturdy welted sole.'},
 {id:'brown-loafers',name:'Tobacco penny loafers',slot:'shoes',model:'loafers',price:360,colour:'#825f42',description:'Low-cut leather with a penny strap and stitched apron toe.'},
];
export const clothingItem = (id: string) => CATALOGUE.find(item => item.id === id);
export type WalletState = { balance: number; salaryProgressMs: number; owned: string[]; outfit: Outfit; revision: number };
export type EconomyView = WalletState & { accruing: boolean };
export const isInShop = (x: number, z: number) => inShop(x, z, .35);
