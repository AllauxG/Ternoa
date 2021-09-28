import { request } from "graphql-request";
import { IUser, IUserDTO } from "../../interfaces/IUser";
import UserModel from "../../models/user";
import NftViewModel from "../../models/nftView";
import UserViewModel from "../../models/userView";
import FollowModel from "../../models/follow";
import QueriesBuilder from "./gqlQueriesBuilder";
import crypto from "crypto";
import { PaginateResult } from "mongoose";
import { AccountResponse, Account } from "../../interfaces/graphQL";
import NodeCache from "node-cache";
import { isValidSignature, validateUrl, validateTwitter } from "../../utils";
import NFTService from "./nft";
import { TIME_BETWEEN_SAME_USER_VIEWS } from "../../utils";
import { CustomResponse } from "../../interfaces/graphQL";
import { INFT } from "../../interfaces/graphQL";

const indexerUrl =
  process.env.INDEXER_URL || "https://indexer.chaos.ternoa.com";

const usersCache = new NodeCache({ stdTTL: 300 });

export class UserService {
  /**
   * Returns all users with pagination
   * @param page - Page number
   * @param limit - Number of users per page
   * @throws Will throw an error if can't fetch users
   */
  async getAllUsers(
    page: number = 1,
    limit: number = 15
  ): Promise<CustomResponse<IUser>> {
    try {
      const res:PaginateResult<IUser>  = await UserModel.paginate({ artist: true }, { page, limit });
      const response: CustomResponse<IUser> = {
        totalCount: res.totalDocs,
        data: res.docs,
        hasNextPage: res.hasNextPage,
        hasPreviousPage: res.hasNextPage
      }
      return response
    } catch (err) {
      throw new Error("Users can't be fetched");
    }
  }

  /**
   * Creates a new user in DB
   * @param userDTO - User data
   * @throws Will throw an error if can't create user
   */
  async createUser(userDTO: IUserDTO): Promise<IUser> {
    const nonce = crypto.randomBytes(16).toString("base64");
    try {
      const newUser = new UserModel({ ...userDTO, nonce });
      return await newUser.save();
    } catch (err) {
      throw new Error("User can't be created");
    }
  }


  /**
   * Creates a new user in DB
   * @param walletId - wallet Id
   * @throws Will throw an error if can't create user
   */
   async reviewRequested(walletId: string): Promise<any> {
    try {
      return UserModel.findOneAndUpdate({walletId}, {reviewRequested: true}, { new: true });
    } catch (err) {
      throw new Error("User can't be updated");
    }
  }

  /**
   * Finds a user in DB
   * @param walletId - User's wallet ID
   * @param incViews - Should increase views counter
   * @param ignoreCache - Should fetch directly from database and ignore cache
   * @throws Will throw an error if wallet ID doesn't exist
   */
  async findUser(
    walletId: string,
    incViews: boolean = false,
    viewerWalletId: string = null,
    viewerIp: string = null, 
    ignoreCache: boolean = false
  ): Promise<IUser> {
    if (!ignoreCache && !incViews) {
      const user = usersCache.get(walletId) as IUser | undefined;
      if (user !== undefined) return user;
    }
    try {
      const user = await UserModel.findOne({ walletId });
      let viewsCount = 0
      if (!user) throw new Error();
      if (incViews){
        const date = +new Date()
        const views = await UserViewModel.find({viewed: walletId})
        if (viewerIp && (views.length === 0 || date - Math.max.apply(null, views.filter(x => x.viewerIp === viewerIp).map(x => x.date)) > TIME_BETWEEN_SAME_USER_VIEWS)){
          const newView = new UserViewModel({viewed: walletId, viewer: viewerWalletId, viewerIp, date})
          await newView.save();
          viewsCount = views.length + 1
        }else{
          viewsCount = views.length
        }
      }
      if (!usersCache.has(walletId)) usersCache.set(walletId, user);
      return {...user.toObject(), viewsCount};
    } catch (err) {
      throw new Error(err + "User can't be found");
    }
  }

  /**
   * Finds multiple users in DB
   * @param wallet ids - An array of users wallet ids
   * @throws Will throw an error if DB can't be reached
   * @return A promise that resolves to the users
   */
  async findUsersByWalletId(walletIds: string[]): Promise<IUser[]> {
    try {
      const users = UserModel.find({ walletId: { $in: walletIds } });
      return users;
    } catch (err) {
      throw new Error("Users can't be found");
    }
  }

  /**
   * Get amount of caps on wallet
   * @param id - User's public address
   * @throws Will throw an error if indexer can't be reached
   * @return A promise that resolves to the account
   */
  async getAccountBalance(id: string): Promise<Account> {
    try {
      const query = QueriesBuilder.capsBalanceFromId(id);
      const result: AccountResponse = await request(indexerUrl, query);
      if (result && result.accountEntities && result.accountEntities.nodes && result.accountEntities.nodes.length) {
        return result.accountEntities.nodes[0];
      } else {
        return { "capsAmount": "0", "tiimeAmount": "0" }
      }
    } catch (err) {
      throw new Error("Couldn't get caps balance");
    }
  }

  /**
   * verify signature and update the user
   * @param walletId - User's public address
   * @param walletData - User's data for update
   * @throws Will throw an error if signature is invalid or if user can't be found in db
   * @return A promise of updated user
   */
  async updateUser(walletId: string, walletData: any): Promise<IUser> {
    try{
      const data = JSON.parse(walletData.data)
      try{
        if (!isValidSignature(walletData.data, walletData.signedMessage, data.walletId)) throw new Error("Invalid signature")
      }catch(err){
        throw new Error("Invalid signature")
      }
      let isError=false
      const {name, customUrl, bio, twitterName, personalUrl, picture, banner} = data
      if (typeof name !== "string" || name.length===0) isError=true
      if (customUrl && (typeof customUrl !== "string" || !validateUrl(customUrl))) isError=true
      if (bio && typeof bio !== "string") isError=true
      if (twitterName && (typeof twitterName !== "string" || !validateTwitter(twitterName))) isError=true
      if (personalUrl && (typeof personalUrl !== "string" || !validateUrl(personalUrl))) isError=true
      if (picture && (typeof picture !== "string" || !validateUrl(picture))) isError=true
      if (banner && (typeof banner !== "string" || !validateUrl(banner))) isError=true
      if (isError) throw new Error("Couldn't update user")
      const userOld = await UserModel.findOne({walletId})
      let twitterVerified = userOld.twitterVerified
      if (userOld.twitterName !== twitterName) twitterVerified = false
      const user = await UserModel.findOneAndUpdate(
        { walletId },
        {name, customUrl, bio, twitterName, personalUrl, picture, banner, twitterVerified},
        {new: true}
      );
      return user
    }catch(err){
      throw err
    }
  }

  /**
   * Like an NFT
   * @param walletId - wallet Id
   * @param nftId - nft Id
   * @throws Will throw an error if already liked or if db can't be reached
   */
   async likeNft(walletId: string, nftId: string): Promise<IUser> {
    try {
      const user  = await UserModel.findOne({walletId});
      const nft  = await NFTService.getNFT(nftId);
      const key = {serieId: nft.serieId, nftId: nft.id}
      if (!user || !nft) throw new Error()
      if (user.likedNFTs){
        if (nft.serieId === "0"){
          if (user.likedNFTs.map(x => x.nftId).includes(key.nftId)) throw new Error("NFT already liked")
        }else{
          if (user.likedNFTs.map(x => x.serieId).includes(key.serieId)) throw new Error("NFT already liked")
        }
        user.likedNFTs.push(key)
      }else{
        user.likedNFTs= [key]
      }
      await user.save()
      return user
    } catch (err) {
      throw new Error("Couldn't like NFT");
    }
  }

  /**
   * Unlike an NFT
   * @param walletId - wallet Id
   * @param nftId - nft Id
   * @throws Will throw an error if already liked or if db can't be reached
   */
   async unlikeNft(walletId: string, nftId: string): Promise<IUser> {
    try {
      const user  = await UserModel.findOne({walletId});
      const nft  = await NFTService.getNFT(nftId);
      const key = {serieId: nft.serieId, nftId: nft.id}
      if (!user || !nft || !user.likedNFTs) throw new Error()
      if (nft.serieId === "0"){
        if (!user.likedNFTs.map(x => x.nftId).includes(key.nftId)) throw new Error("NFT already not liked")
        user.likedNFTs = user.likedNFTs.filter(x => x.nftId !== key.nftId)
      }else{
        if (!user.likedNFTs.map(x => x.serieId).includes(key.serieId)) throw new Error("NFT already not liked")
        user.likedNFTs = user.likedNFTs.filter(x => x.serieId !== key.serieId)
      }
      await user.save()
      return user
    } catch (err) {
      throw new Error("Couldn't unlike NFT");
    }
  }

  /**
   * gets liked NFTs
   * @param walletId - wallet Id
   * @param page? - Page number
   * @param limit? - Number of elements per page
   * @throws Will throw an error if db can't be reached
   */
   async getLikedNfts(walletId: string, page?: string, limit?: string): Promise<CustomResponse<INFT>> {
    try {
      if (page && limit){
        const totalLikedNfts = (await UserModel.findOne({walletId})).likedNFTs.length
        const likedIndexStart = (Number(page)-1)*Number(limit)
        const hasNextPage = likedIndexStart+Number(limit) < totalLikedNfts
        const hasPreviousPage = Number(page) > 1 && likedIndexStart>0
        if (likedIndexStart >= totalLikedNfts) throw new Error("Pagination parameters are incorrect");
        const user  = await UserModel.findOne({walletId}, {likedNFTs: {$slice: [likedIndexStart, Number(limit)]}});
        if (!user.likedNFTs) return {data: [], totalCount: 0, hasNextPage: false, hasPreviousPage:false}
        const response = await NFTService.getNFTsFromIds(user.likedNFTs.map(x=>x.nftId))
        response.hasNextPage = hasNextPage
        response.hasPreviousPage = hasPreviousPage
        return response
      }else{
        const user  = await UserModel.findOne({walletId});
        if (!user.likedNFTs) return {data: [], totalCount: 0}
        const response = await NFTService.getNFTsFromIds(user.likedNFTs.map(x=>x.nftId))
        return response
      }
    } catch (err) {
      throw new Error("Couldn't get liked NFTs");
    }
  }

  /**
   * store temporary oauth twitter token to validate user
   * @param walletId - wallet Id
   * @param oauthToken - Oauth token
   * @throws Will throw an error if db can't be reached
   */
   async setTwitterVerificationToken(walletId: string, oauthToken: string): Promise<void> {
    try{
      await UserModel.findOneAndUpdate(
        { walletId },
        {twitterVerificationToken: oauthToken}
      );
    }catch(err){
      throw err
    }
  }

  /**
   * Get's the user by oauth verification token
   * @param oauthToken - Oauth token
   * @throws Will throw an error if db can't be reached
   */
   async getUserByTwitterVerificationToken(oauthToken: string): Promise<IUser> {
    try{
      return await UserModel.findOne({ twitterVerificationToken: oauthToken });
    }catch(err){
      throw err
    }
  }

  /**
   * Validate the twitter username
   * @param isValid - if his twitter name matches the one entered in profile page
   * @param walletId - wallet id
   * @throws Will throw an error if db can't be reached
   */
    async validateTwitter(isValid: boolean, walletId: string): Promise<void> {
    try{
        await UserModel.findOneAndUpdate(
          { walletId },
          { twitterVerificationToken: '',twitterVerified: isValid }
        );
    }catch(err){
      throw err
    }
  }

  async dataTransfer(): Promise<void>{
    try{
      /*// USER LIKES
      const users = await UserModel.find()
      users.forEach(async user => {
        if (user.likedNFTs && user.likedNFTs.length>0){
          const newLikes = [] as any[]
          user.likedNFTs.forEach(async like => {
            if (typeof like === 'string'){
              const serieId = (await NFTService.getNFT(like)).serieId
              if (serieId){
                newLikes.push(
                  {
                    serieId,
                    nftId: like
                  }
                )
              }
            }
          })
          user.likedNFTs = newLikes
          await user.save()
        }
      });
      // NFT VIEWS
      const nftViews = await NftViewModel.find()
      const viewsToDelete = [] as any
      nftViews.forEach(async nftView => {
        const viewedId = (nftView as any).viewed
        const viewedSerie = (await NFTService.getNFT(viewedId)).serieId
        if (viewedSerie){
          nftView.viewedId = viewedId;
          nftView.viewedSerie = viewedSerie;
          (nftView as any).viewed = undefined;
          await nftView.save()
        }else{
          viewsToDelete.push(nftView._id)
        }
      })
      // Delete old views
      // tslint:disable-next-line:no-console
      console.log(viewsToDelete)
      NftViewModel.deleteMany({_id: {$in: viewsToDelete.map((x: any) => x._id)}})
      // FOLLOWS
      const follows = await FollowModel.find()
      const followsToDelete = [] as string[]
      follows.forEach(async x =>{
        const followed = await UserModel.findOne({_id: x.followed})
        const follower = await UserModel.findOne({_id: x.follower})
        if (followed && follower){
          x.followed = followed.walletId
          x.follower = follower.walletId
          await x.save()
        }else{
          followsToDelete.push(x._id)
        }
      })
      // tslint:disable-next-line:no-console
      console.log(followsToDelete)
      // FollowModel.deleteMany({_id: {$in: followsToDelete}})*/
    }catch(err){
      throw err
    }
  }
}

export default new UserService();
