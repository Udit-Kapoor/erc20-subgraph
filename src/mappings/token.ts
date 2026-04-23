import { Address, BigDecimal, Bytes, ethereum } from '@graphprotocol/graph-ts'

import { ERC20, Transfer } from '../../generated/xU3O8/ERC20'

import { Token, BurnEvent, MintEvent, TransferEvent, UserTransfer } from '../../generated/schema'

import { toDecimal, ONE, ZERO } from '../helpers/number'
import { DEFAULT_DECIMALS } from '../helpers/token'

import {
  decreaseAccountBalance,
  getOrCreateAccount,
  increaseAccountBalance,
  saveAccountBalanceSnapshot,
} from './account'

const GENESIS_ADDRESS = '0x0000000000000000000000000000000000000000'

function getOrCreateToken(address: Address): Token {
  let id = address.toHex()
  let token = Token.load(id)
  if (token != null) return token as Token

  let contract = ERC20.bind(address)
  let newToken = new Token(id)
  newToken.address = address

  let nameResult = contract.try_name()
  newToken.name = nameResult.reverted ? '' : nameResult.value

  let symbolResult = contract.try_symbol()
  newToken.symbol = symbolResult.reverted ? '' : symbolResult.value

  let decimalsResult = contract.try_decimals()
  newToken.decimals = decimalsResult.reverted ? DEFAULT_DECIMALS : decimalsResult.value

  let supplyResult = contract.try_totalSupply()
  newToken.totalSupply = supplyResult.reverted
    ? ZERO.toBigDecimal()
    : toDecimal(supplyResult.value, newToken.decimals)

  newToken.description = null
  newToken.imageUrl = null
  newToken.flags = []
  newToken.paused = false
  newToken.eventCount = ZERO
  newToken.burnEventCount = ZERO
  newToken.mintEventCount = ZERO
  newToken.transferEventCount = ZERO
  newToken.totalBurned = ZERO.toBigDecimal()
  newToken.totalMinted = ZERO.toBigDecimal()
  newToken.totalTransferred = ZERO.toBigDecimal()

  newToken.save()
  return newToken as Token
}

function createUserTransfer(
  userId: string,
  tokenId: string,
  direction: string,
  counterparty: Bytes,
  amount: BigDecimal,
  event: ethereum.Event,
): void {
  let id = event.transaction.hash.toHex() + '-' + event.logIndex.toString() + '-' + direction + '-' + userId
  let userTransfer = new UserTransfer(id)
  userTransfer.user = userId
  userTransfer.token = tokenId
  userTransfer.direction = direction
  userTransfer.counterparty = counterparty
  userTransfer.amount = amount
  userTransfer.block = event.block.number
  userTransfer.timestamp = event.block.timestamp
  userTransfer.transaction = event.transaction.hash
  userTransfer.save()
}

export function handleTransfer(event: Transfer): void {
  let token = getOrCreateToken(event.address)
  let amount = toDecimal(event.params.value, token.decimals)

  let isBurn = event.params.to.toHex() == GENESIS_ADDRESS
  let isMint = event.params.from.toHex() == GENESIS_ADDRESS
  let isTransfer = !isBurn && !isMint

  let eventId: string = ''
  if (isBurn) {
    eventId = handleBurnEvent(token, amount, event.params.from, event).id
  } else if (isMint) {
    eventId = handleMintEvent(token, amount, event.params.to, event).id
  } else {
    eventId = handleTransferEvent(token, amount, event.params.from, event.params.to, event).id
  }

  if (isBurn || isTransfer) {
    let account = getOrCreateAccount(event.params.from)
    let balance = decreaseAccountBalance(account, token, amount)
    balance.block = event.block.number
    balance.modified = event.block.timestamp
    balance.transaction = event.transaction.hash
    account.save()
    balance.save()
    saveAccountBalanceSnapshot(balance, eventId, event)
    createUserTransfer(account.id, token.id, 'sent', event.params.to, amount, event)
  }

  if (isMint || isTransfer) {
    let account = getOrCreateAccount(event.params.to)
    let balance = increaseAccountBalance(account, token, amount)
    balance.block = event.block.number
    balance.modified = event.block.timestamp
    balance.transaction = event.transaction.hash
    account.save()
    balance.save()
    saveAccountBalanceSnapshot(balance, eventId, event)
    createUserTransfer(account.id, token.id, 'received', event.params.from, amount, event)
  }
}

function handleBurnEvent(token: Token, amount: BigDecimal, burner: Bytes, event: ethereum.Event): BurnEvent {
  let burnEvent = new BurnEvent(event.transaction.hash.toHex() + '-' + event.logIndex.toString())
  burnEvent.token = token.id
  burnEvent.amount = amount
  burnEvent.sender = event.transaction.from
  burnEvent.burner = burner
  burnEvent.block = event.block.number
  burnEvent.timestamp = event.block.timestamp
  burnEvent.transaction = event.transaction.hash
  burnEvent.save()

  token.eventCount = token.eventCount.plus(ONE)
  token.burnEventCount = token.burnEventCount.plus(ONE)
  token.totalSupply = token.totalSupply.minus(amount)
  token.totalBurned = token.totalBurned.plus(amount)
  token.save()

  return burnEvent
}

function handleMintEvent(token: Token, amount: BigDecimal, destination: Bytes, event: ethereum.Event): MintEvent {
  let mintEvent = new MintEvent(event.transaction.hash.toHex() + '-' + event.logIndex.toString())
  mintEvent.token = token.id
  mintEvent.amount = amount
  mintEvent.sender = event.transaction.from
  mintEvent.destination = destination
  mintEvent.minter = event.transaction.from
  mintEvent.block = event.block.number
  mintEvent.timestamp = event.block.timestamp
  mintEvent.transaction = event.transaction.hash
  mintEvent.save()

  token.eventCount = token.eventCount.plus(ONE)
  token.mintEventCount = token.mintEventCount.plus(ONE)
  token.totalSupply = token.totalSupply.plus(amount)
  token.totalMinted = token.totalMinted.plus(amount)
  token.save()

  return mintEvent
}

function handleTransferEvent(
  token: Token,
  amount: BigDecimal,
  source: Bytes,
  destination: Bytes,
  event: ethereum.Event,
): TransferEvent {
  let transferEvent = new TransferEvent(event.transaction.hash.toHex() + '-' + event.logIndex.toString())
  transferEvent.token = token.id
  transferEvent.amount = amount
  transferEvent.sender = source
  transferEvent.source = source
  transferEvent.destination = destination
  transferEvent.block = event.block.number
  transferEvent.timestamp = event.block.timestamp
  transferEvent.transaction = event.transaction.hash
  transferEvent.save()

  token.eventCount = token.eventCount.plus(ONE)
  token.transferEventCount = token.transferEventCount.plus(ONE)
  token.totalTransferred = token.totalTransferred.plus(amount)
  token.save()

  return transferEvent
}
